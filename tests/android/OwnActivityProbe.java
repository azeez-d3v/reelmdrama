package org.reelm.drama.uiprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.view.accessibility.AccessibilityNodeInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Standalone test APK. Native suites invoke only the E2E native entrypoint. Never uses shell input, UiAutomation injection,
 * another package, microphone, screenshot or device-setting API. Actual dispatch receipts
 * are not native decoded-playback proof; root separately correlates app telemetry/images. */
public final class OwnActivityProbe extends Instrumentation {
  private String TARGET;
  private String ACTIVITY;
  private String CONSUMER_URI;
  private String suite;
  private boolean verifyUpgrade,stageCandidate;
  private int fontPercent;
  private String continuityJson;
  private String captureToken;
  private volatile String captureStage;
  private volatile CountDownLatch captureComplete;
  private static final long ACQUISITION_TIMEOUT_MS = 20000;
  private static final long MAIN_OPERATION_TIMEOUT_MS = 5000;
  private Activity activity;
  private final JSONArray rows = new JSONArray();

  @Override public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
    TARGET = arguments.getString("targetPackage"); ACTIVITY = TARGET + ".MainActivity";
    CONSUMER_URI = arguments.getString("consumerUri"); suite = arguments.getString("suite");
    verifyUpgrade="1".equals(arguments.getString("verifyUpgrade"));
    stageCandidate="1".equals(arguments.getString("stageCandidate"));
    fontPercent=Integer.parseInt(arguments.getString("fontPercent","130"));
    continuityJson=arguments.getString("continuityJson","");
    captureToken=arguments.getString("captureToken","");
    start();
  }
  @Override public void onStart() {
    boolean completed = false;
    String failure = null;
    try {
      require(TARGET.equals(getTargetContext().getPackageName()), "EXACT_TARGET_PACKAGE_REQUIRED");
      // startActivitySync can wait indefinitely for a SingleTask activity's idle
      // callback. The monitor is installed first and records only this exact
      // target activity. The wrapper delivers the normal consumer intent only
      // after this actual monitor-armed status; its literal URI is shell-quoted.
      ActivityMonitor monitor = addMonitor(ACTIVITY, null, false);
      stage("monitor-armed", "EXACT_OWN_ACTIVITY_MONITOR_ARMED", null);
      long acquisitionStarted = SystemClock.uptimeMillis();
      try {
        activity = monitor.waitForActivityWithTimeout(ACQUISITION_TIMEOUT_MS);
      } finally { removeMonitor(monitor); }
      require(activity != null && TARGET.equals(activity.getPackageName())
          && ACTIVITY.equals(activity.getClass().getName()), "EXACT_OWN_ACTIVITY_REQUIRED");
      stage("consumer-launch", "OWN_ACTIVITY_STARTED", new JSONObjectSafe()
          .put("acquisitionMethod", "exact-own-ActivityMonitor-after-receipted-shell-consumer-start")
          .put("timeoutMs", ACQUISITION_TIMEOUT_MS)
          .put("elapsedMs", SystemClock.uptimeMillis() - acquisitionStarted).json);
      if("update-feed".equals(suite)){updateFeedChecks();completed=true;}else if("simplification".equals(suite)){simplificationChecks();completed=true;}else if("preferences".equals(suite)){preferenceChecks();completed=true;}else if("install-ui".equals(suite)){openUpdateInstall();completed=true;}else if("updates".equals(suite)&&(verifyUpgrade||stageCandidate)){updateContinuity();if(stageCandidate)stageUpdateCandidate();completed=true;}else if("episode".equals(suite)){episodeChecks();completed=true;} else if("resume".equals(suite)){resumeChecks();completed=true;} else if (!"player".equals(suite) && !"baseline".equals(suite) && !"settings".equals(suite)) {
        Class<?> checks = activity.getClassLoader().loadClass("expo.modules.video.ReelmNativeChecks");
        Object report = checks.getMethod("run", android.content.Context.class, String.class)
            .invoke(null, activity.getApplicationContext(), suite);
        stage("native-suite", "NATIVE_SUITE_CHECK_COMPLETE", new JSONObjectSafe().put("nativeReport", new JSONObject((java.util.Map<?, ?>) report)).json);
        completed = true;
      } else {
      require(waitOwnFocus(35000), "OWN_ACTIVITY_DID_NOT_REGAIN_FOCUS_AFTER_DETAIL_LOADING");
      // Normal foreground re-delivery is distinct from cold-link verification.
      // No app e2e action, source override, callback or app test hook is invoked.
      final Intent warm = new Intent(Intent.ACTION_VIEW, Uri.parse(CONSUMER_URI));
      warm.setComponent(new ComponentName(TARGET, ACTIVITY));
      warm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      long warmStartedDeviceTimeMs = dispatchWarmWhenOwnReady(warm, 35000);
      require(warmStartedDeviceTimeMs > 0,
          "OWN_REACT_UI_DID_NOT_REGAIN_ATOMIC_WARM_CONSUMER_READINESS");
      SystemClock.sleep(500);
      final boolean[] intentMatched = {false};
      onMain(() -> {require(activity != null && !activity.isFinishing()
          && TARGET.equals(activity.getPackageName()) && ACTIVITY.equals(activity.getClass().getName()),
          "EXACT_OWN_ACTIVITY_REQUIRED");
        Intent observed = activity.getIntent();
        intentMatched[0] = observed != null && Intent.ACTION_VIEW.equals(observed.getAction())
            && CONSUMER_URI.equals(observed.getDataString());});
      stage("warm-consumer-delivery", "ORDINARY_OWN_FOREGROUND_CONSUMER_INTENT_DISPATCHED",
          new JSONObjectSafe().put("deliveryStartedDeviceTimeMs", warmStartedDeviceTimeMs)
          .put("method", "own-focused-Activity.startActivity-ACTION_VIEW")
          .put("activityIntentDataMatched", intentMatched[0]).json);
      require(intentMatched[0], "ACTUAL_OWN_ACTIVITY_CONSUMER_INTENT_DATA_MISMATCH");
      require(waitNativePlaying(35000), "ORDINARY_SOURCE_NOT_PLAYING_WITHIN_35_SECONDS");
      // Read native ExoPlayer position and decoder counters, never JS clock labels.
      observe("before-hold", 1500);
      hold(6000);
      observe("after-release", 1500);
      require(waitNativePlaying(5000), "HOLD_RELEASE_ALSO_PAUSED_PLAYBACK");
      // Stop through an actual measured transport button; leave legacy app data intact.
      if (!labelExists("Pause episode")) tapSurface();
      if (labelExists("Pause episode")) tapLabel("Pause episode");
      observe("final-paused", 1000);
      if("settings".equals(suite)) settingsChecks();
      completed = true;
      }
    } catch (Throwable exception) {
      // No exception message/URL/title/window dump enters output.
      Throwable cause = exception instanceof java.lang.reflect.InvocationTargetException
          ? ((java.lang.reflect.InvocationTargetException)exception).getCause() : exception;
      failure = cause instanceof IllegalArgumentException && "UNKNOWN_NATIVE_SUITE".equals(cause.getMessage())
          ? "UNKNOWN_NATIVE_SUITE"
          : exception instanceof ProbeFailure ? exception.getMessage()
          : "INSTRUMENTATION_EXCEPTION_" + cause.getClass().getSimpleName() + (cause.getMessage()!=null&&cause.getMessage().matches("[A-Z0-9_]+")?"_"+cause.getMessage():"");
    }
    Bundle result = new Bundle();
    try {
      JSONObject output = new JSONObject().put("schemaVersion", 1)
          .put("evidenceKind", "actual-owned-activity-dispatch-instrumentation")
          .put("targetPackage", TARGET).put("targetActivity", ACTIVITY)
          .put("suite", suite).put("initialEpisode", Uri.parse(CONSUMER_URI).getQueryParameter("episode")==null?0:Integer.parseInt(Uri.parse(CONSUMER_URI).getQueryParameter("episode")))
          .put("completed", completed).put("failure", failure == null ? JSONObject.NULL : failure)
          .put("stages", rows)
          .put("qualification", "Actual main-thread owned decorView MotionEvent dispatch and observed own UI labels/text. Not human taps or shell input. Native positions and renderedOutputBufferCount are independently read from the visible own ExoPlayer; UI labels are not used as clock proof.");
      result.putString("probeJSON", output.toString());
    } catch (Throwable ignored) { result.putString("probeError", "RESULT_SERIALIZATION_ERROR"); }
    finish(completed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
  }

  private void updateFeedChecks() throws Exception {
    waitUi("Home",40000);uiClick("Settings");scrollToUi("Check GitHub for app updates",false);
    String before=sha(java.nio.file.Files.readAllBytes(new java.io.File(activity.getFilesDir(),"reelm-drama-library.json").toPath()));
    uiClick("Check GitHub for app updates");waitUi("No newer public release is available.",25000);
    swipe("settings-scroll",.5f,.7f,.5f,.4f,400);SystemClock.sleep(350);waitUi("No newer public release is available.",5000);
    for(String label:new String[]{"Download and verify app update","Retry APK download","Install verified APK with Android confirmation"})require(uiLabel(ownUi(),label)==null,"OLDER_UPDATE_ACTION_PRESENT");
    Class<?> type=activity.getClassLoader().loadClass("expo.modules.video.ReelmApkUpdater");Object companion=type.getField("Companion").get(null),updater=companion.getClass().getMethod("get",android.content.Context.class).invoke(companion,activity.getApplicationContext());
    java.util.Map<?,?> status=(java.util.Map<?,?>)type.getMethod("status").invoke(updater);require("idle".equals(status.get("state"))&&status.get("errorCode")==null,"UPDATE_NATIVE_FAILURE_PRESENT");
    require(before.equals(sha(java.nio.file.Files.readAllBytes(new java.io.File(activity.getFilesDir(),"reelm-drama-library.json").toPath()))),"UPDATE_CHECK_CHANGED_LIBRARY");
    android.content.BroadcastReceiver receiver=new android.content.BroadcastReceiver(){@Override public void onReceive(android.content.Context context,Intent intent){CountDownLatch pending=captureComplete;if(pending!=null&&captureToken.equals(intent.getStringExtra("token"))&&captureStage.equals(intent.getStringExtra("stage")))pending.countDown();}};
    require(captureToken.matches("[a-f0-9-]{36}"),"CAPTURE_ACK_TOKEN_REQUIRED");android.content.IntentFilter filter=new android.content.IntentFilter(TARGET+".uiprobe.capture");
    if(android.os.Build.VERSION.SDK_INT>=33)getTargetContext().registerReceiver(receiver,filter,android.content.Context.RECEIVER_EXPORTED);else getTargetContext().registerReceiver(receiver,filter);
    try{captureStage="update-feed-current";captureComplete=new CountDownLatch(1);stage(captureStage,"ORDINARY_PUBLIC_GITHUB_CHECK",new JSONObjectSafe().put("currentUI",true).put("olderActionsAbsent",true).put("nativeState",status.get("state")).put("libraryUnchanged",true).json);require(captureComplete.await(15,TimeUnit.SECONDS),"OWN_STAGE_CAPTURE_ACK_TIMEOUT");}finally{captureComplete=null;getTargetContext().unregisterReceiver(receiver);}
  }
  private void simplificationChecks() throws Exception {
    waitUi("Home",40000);uiClick("Home");
    java.io.File libraryFile=new java.io.File(activity.getFilesDir(),"reelm-drama-library.json");
    String originalHash=sha(java.nio.file.Files.readAllBytes(libraryFile.toPath()));JSONObject original=library().getJSONObject("preferences");
    int originalFont=(int)Math.round(original.getDouble("fontScale")*100);double originalHold=original.getDouble("holdSpeed");
    android.accessibilityservice.AccessibilityServiceInfo info=getUiAutomation().getServiceInfo();int originalFlags=info.flags;
    info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;getUiAutomation().setServiceInfo(info);
    android.content.BroadcastReceiver captureReceiver=new android.content.BroadcastReceiver(){@Override public void onReceive(android.content.Context context,Intent intent){CountDownLatch pending=captureComplete;if(pending!=null&&captureToken.equals(intent.getStringExtra("token"))&&captureStage.equals(intent.getStringExtra("stage")))pending.countDown();}};
    boolean touched=false,registered=false;
    try {
      require(captureToken.matches("[a-f0-9-]{36}"),"CAPTURE_ACK_TOKEN_REQUIRED");android.content.IntentFilter filter=new android.content.IntentFilter(TARGET+".uiprobe.capture");
      if(android.os.Build.VERSION.SDK_INT>=33)getTargetContext().registerReceiver(captureReceiver,filter,android.content.Context.RECEIVER_EXPORTED);else getTargetContext().registerReceiver(captureReceiver,filter);registered=true;
      JSONArray tabs=visibleTabs();require(tabs.length()==3,"EXACT_THREE_TABS_REQUIRED");
      for(String label:new String[]{"Home","Library","Settings"})require(waitUi(label,10000)!=null,"RETAINED_TAB_REQUIRED");
      require(uiLabel(ownUi(),"Discover")==null&&uiLabel(ownUi(),"Search catalogue")==null&&uiLabel(ownUi(),"Search")==null&&uiLabel(ownUi(),"Downloads")==null,"REMOVED_HEADER_ACTION_OR_DISCOVER");
      AccessibilityNodeInfo search=waitUi("Search drama titles",10000);require("catalogue-search-input".equals(search.getViewIdResourceName())&&search.getClassName().toString().contains("EditText"),"HOME_REAL_INLINE_SEARCH_REQUIRED");
      waitUi("Show all platforms",10000);long until=SystemClock.uptimeMillis()+40000;AccessibilityNodeInfo platform;
      while((platform=firstPlatform(ownUi()))==null&&SystemClock.uptimeMillis()<until)SystemClock.sleep(200);require(platform!=null,"NONEMPTY_PLATFORM_DIRECTORY_REQUIRED");
      simplifiedStage("home",new JSONObjectSafe().put("tabs",tabs).put("inlineSearch",true).put("platformChip",true).put("platformDirectoryNonempty",true).json);
      uiClick("Library");waitUi("Saved",10000);waitUi("Recents",10000);require(visibleTabs().length()==3&&uiLabel(ownUi(),"Discover")==null,"LIBRARY_THREE_TABS_REQUIRED");
      simplifiedStage("library",new JSONObjectSafe().put("savedAndRecents",true).put("librarySHA256",sha(java.nio.file.Files.readAllBytes(libraryFile.toPath()))).json);
      uiClick("Settings");waitUi("App updates",10000);touched=true;uiClick("Subtitle size 100 percent");SystemClock.sleep(650);JSONObject base=subtitleMetrics();
      simplifiedStage("settings-100",base);
      uiClick("Subtitle size 130 percent");SystemClock.sleep(650);JSONObject large=subtitleMetrics();
      require(Math.abs(large.getDouble("previewTextSizePx")/base.getDouble("previewTextSizePx")-1.3)<.03,"SUBTITLE_PREVIEW_SCALE_REQUIRED");
      for(String key:new String[]{"playbackTextSizePx","holdLabelTextSizePx","updatesTextSizePx"})require(Math.abs(large.getDouble(key)-base.getDouble(key))<.1,"NON_SUBTITLE_TEXT_SIZE_CHANGED");
      require(library().getJSONObject("preferences").getDouble("fontScale")==1.3&&library().getJSONObject("preferences").getDouble("holdSpeed")==originalHold,"SUBTITLE_ONLY_PREFERENCE_REQUIRED");
      simplifiedStage("settings-130",new JSONObjectSafe().put("nativeTextSizes",large).put("onlySubtitlePreviewChanged",true).json);
      scrollToUi("Export library and preferences",false);waitUi("Import library and preferences",10000);
      JSONObject transfer=new JSONObject();onMain(()->{ownWindow();try{for(String action:new String[]{"Export","Import"}){View button=findLabel(activity.getWindow().getDecorView(),action+" library and preferences");TextView text=findTextView(activity.getWindow().getDecorView(),action);float density=activity.getResources().getDisplayMetrics().density;require(button!=null&&text!=null&&button.getWidth()/density>=47.5&&button.getHeight()/density>=47.5&&text.getTextSize()/density>=11.5&&button.getBackground()!=null,"READABLE_FILLED_TRANSFER_BUTTON_REQUIRED");transfer.put(action,new JSONObject().put("widthDp",button.getWidth()/density).put("heightDp",button.getHeight()/density).put("textSizePx",text.getTextSize()).put("textColor",text.getCurrentTextColor()).put("nativeBackground",button.getBackground().getClass().getSimpleName()));}}catch(Exception failure){throw new ProbeFailure("TRANSFER_NATIVE_INSPECTION_FAILED");}});
      simplifiedStage("transfer",transfer);
      uiClick("Home");Intent detail=new Intent(Intent.ACTION_VIEW,Uri.parse(CONSUMER_URI));detail.setComponent(new ComponentName(TARGET,ACTIVITY));detail.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      require(dispatchWarmWhenOwnReady(detail,10000)>0,"ORDINARY_DETAIL_CONSUMER_REQUIRED");waitUi("Close story details",40000);
      until=SystemClock.uptimeMillis()+40000;while(uiLabel(ownUi(),"Save on this device")==null&&uiLabel(ownUi(),"Remove from saved on this device")==null&&SystemClock.uptimeMillis()<until)SystemClock.sleep(200);
      require(uiLabel(ownUi(),"Save on this device")!=null||uiLabel(ownUi(),"Remove from saved on this device")!=null,"DETAIL_LOADED_REQUIRED");require(uiLabel(ownUi(),"Download episodes")==null,"OFFLINE_EPISODE_ACTION_PRESENT");
      simplifiedStage("detail",new JSONObjectSafe().put("ordinarySeriesConsumer",true).put("downloadEpisodesAbsent",true).json);uiClick("Close story details");
    } finally {
      try {
        if(uiLabel(ownUi(),"Close story details")!=null)uiClick("Close story details");
        if(touched){uiClick("Settings");scrollToUi("Subtitle size "+originalFont+" percent",true);uiClick("Subtitle size "+originalFont+" percent");}
        long settle=SystemClock.uptimeMillis()+10000;String restored;
        while(!(restored=sha(java.nio.file.Files.readAllBytes(libraryFile.toPath()))).equals(originalHash)&&SystemClock.uptimeMillis()<settle)SystemClock.sleep(200);
        JSONObject preferences=library().getJSONObject("preferences");require(preferences.getDouble("fontScale")==originalFont/100.0&&preferences.getDouble("holdSpeed")==originalHold&&restored.equals(originalHash),"ORIGINAL_LIBRARY_AND_PREFERENCES_RESTORE_REQUIRED");
        uiClick("Home");if(registered)simplifiedStage("restored",new JSONObjectSafe().put("librarySHA256",restored).put("fontScale",preferences.getDouble("fontScale")).put("holdSpeed",originalHold).put("preferencesRestored",true).json);
      } finally {try{if(registered)getTargetContext().unregisterReceiver(captureReceiver);}finally{info.flags=originalFlags;getUiAutomation().setServiceInfo(info);}}
    }
  }
  private void simplifiedStage(String name,JSONObject data){CountDownLatch pending=new CountDownLatch(1);captureStage="simplification-"+name;captureComplete=pending;try{stage(captureStage,"OWN_UI_AND_NATIVE_MEASUREMENTS",data);require(pending.await(15,TimeUnit.SECONDS),"OWN_STAGE_CAPTURE_ACK_TIMEOUT");}catch(InterruptedException failure){Thread.currentThread().interrupt();throw new ProbeFailure("OWN_STAGE_CAPTURE_INTERRUPTED");}finally{captureComplete=null;}}
  private JSONArray visibleTabs(){JSONArray tabs=new JSONArray();collectTabs(ownUi(),tabs);for(int i=0;i<tabs.length();i++)require(java.util.Arrays.asList("tab-home","tab-saved","tab-settings").contains(tabs.optString(i)),"UNEXPECTED_TAB_PRESENT");return tabs;}
  private void collectTabs(AccessibilityNodeInfo node,JSONArray tabs){if(node==null)return;String id=node.getViewIdResourceName();if(node.isVisibleToUser()&&id!=null&&id.startsWith("tab-")){tabs.put(id);return;}for(int i=0;i<node.getChildCount();i++)collectTabs(node.getChild(i),tabs);}
  private AccessibilityNodeInfo firstPlatform(AccessibilityNodeInfo node){if(node==null)return null;String label=String.valueOf(node.getContentDescription());if(node.isVisibleToUser()&&label.startsWith("Show ")&&label.endsWith(" dramas"))return node;for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=firstPlatform(node.getChild(i));if(found!=null)return found;}return null;}
  private void scrollToUi(String label,boolean top){for(int i=0;i<8;i++){AccessibilityNodeInfo node=uiLabel(ownUi(),label);if(node!=null&&node.isVisibleToUser())return;swipe("settings-scroll",.5f,top?.35f:.75f,.5f,top?.75f:.35f,400);SystemClock.sleep(300);}throw new ProbeFailure("SETTINGS_CONTROL_NOT_VISIBLE");}
  private JSONObject subtitleMetrics(){JSONObject result=new JSONObject();onMain(()->{ownWindow();try{String[] labels={"Your subtitle preview","Playback","Press-and-hold speed","App updates"},keys={"previewTextSizePx","playbackTextSizePx","holdLabelTextSizePx","updatesTextSizePx"};for(int i=0;i<labels.length;i++){TextView text=findTextView(activity.getWindow().getDecorView(),labels[i]);require(text!=null,"VISIBLE_SETTINGS_TEXT_REQUIRED");result.put(keys[i],text.getTextSize());}}catch(Exception failure){throw new ProbeFailure("NATIVE_SUBTITLE_MEASUREMENTS_FAILED");}});return result;}

  private void episodeChecks() throws Exception {
    require(waitOwnFocus(35000),"EPISODE_OWN_FOCUS_REQUIRED");
    Intent warm=new Intent(Intent.ACTION_VIEW,Uri.parse(CONSUMER_URI));warm.setComponent(new ComponentName(TARGET,ACTIVITY));warm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    require(dispatchWarmWhenOwnReady(warm,35000)>0,"EPISODE_CONSUMER_DELIVERY_REQUIRED");
    if(waitLabel("Try again",5000)){tapLabel("Try again");stage("episode-retry","ACTUAL_OWN_RETRY_BUTTON_DISPATCHED",null);}
    require(waitNativePlaying(35000),"EPISODE_RETRY_NO_NATIVE_PLAYBACK");observe("episode-playing",8000);
  }
  private void resumeChecks() throws Exception {
    String slug=Uri.parse(CONSUMER_URI).getQueryParameter("slug");JSONObject before=library().getJSONObject("progress").getJSONObject(slug);
    stage("resume-setup","NATIVE_PERSISTED_PROGRESS",before);require(Math.abs(before.getDouble("time")-32)<.01,"SAVED32_SETUP_REQUIRED");
    final boolean[] pending={false};onMain(()->{try{Object player=ownPlayer(activity.getWindow().getDecorView());pending[0]=player==null||((Number)invoke(player,"getCurrentPosition")).longValue()<31000;}catch(Exception e){throw new ProbeFailure("PENDING_NATIVE_READ_FAILED");}activity.moveTaskToBack(true);});
    require(pending[0],"INITIAL_NATIVE_TARGET_ALREADY_OBSERVED_NO_PENDING_PROOF");SystemClock.sleep(1200);
    JSONObject after=library().getJSONObject("progress").getJSONObject(slug);require(after.getDouble("time")==before.getDouble("time")&&after.getInt("episode")==before.getInt("episode"),"BACKGROUND_PENDING_RESUME_OVERWROTE32");
    stage("pending-background","NATIVE_FILE_RETAINS32_BEFORE_TARGET_OBSERVED",new JSONObjectSafe().put("time",after.getDouble("time")).put("episode",after.getInt("episode")).put("targetNotYetObserved",pending[0]).json);
    onMain(()->{Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(CONSUMER_URI));intent.setComponent(new ComponentName(TARGET,ACTIVITY));intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity.startActivity(intent);});
    require(waitOwnFocus(35000),"RESUME_FOREGROUND_FOCUS_REQUIRED");require(waitNativePlaying(35000),"RESUME_SOURCE_NOT_PLAYING");JSONObject n=nativeSnapshot();long position=n.getLong("positionMs");require(position>=31000&&position<=37000,"RESUME_EXACT_EPISODE_TIME_NOT_OBSERVED");stage("resume-target","INDEPENDENT_NATIVE_AFTER_PROCESS_RESTART",n);
    if(!labelExists("Pause episode"))tapSurface();tapLabel("Pause episode");
  }
  private AccessibilityNodeInfo uiLabel(AccessibilityNodeInfo node,String label) {
    if(node==null)return null;
    if(label.contentEquals(node.getContentDescription()==null?"":node.getContentDescription())||label.contentEquals(node.getText()==null?"":node.getText()))return node;
    for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=uiLabel(node.getChild(i),label);if(found!=null)return found;}
    return null;
  }
  private AccessibilityNodeInfo ownUi() {
    AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();
    return root!=null&&TARGET.contentEquals(root.getPackageName()==null?"":root.getPackageName())?root:null;
  }
  private AccessibilityNodeInfo waitUi(String label,long timeout) {
    long end=SystemClock.uptimeMillis()+timeout;
    while(SystemClock.uptimeMillis()<end){AccessibilityNodeInfo node=uiLabel(ownUi(),label);if(node!=null&&node.isVisibleToUser())return node;SystemClock.sleep(200);}
    throw new ProbeFailure("OWN_UI_LABEL_TIMEOUT");
  }
  private void uiClick(String label) {
    long until=SystemClock.uptimeMillis()+10000;AccessibilityNodeInfo node;
    while((node=uiAction(ownUi(),label))==null&&SystemClock.uptimeMillis()<until)SystemClock.sleep(200);
    require(node!=null,"OWN_UI_ACTION_TIMEOUT");
    require(TARGET.contentEquals(node.getPackageName())&&node.isEnabled()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK),"OWN_UI_ACCESSIBILITY_CLICK_FAILED");
    stage("ui-click","OWN_PACKAGE_ACCESSIBILITY_ACTION_CLICK",new JSONObjectSafe().label(label).json);SystemClock.sleep(450);
  }
  private AccessibilityNodeInfo uiAction(AccessibilityNodeInfo node,String label){if(node==null)return null;if(node.isVisibleToUser()&&node.isEnabled()&&node.isClickable()&&label.contentEquals(node.getContentDescription()==null?"":node.getContentDescription()))return node;for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=uiAction(node.getChild(i),label);if(found!=null)return found;}return null;}
  private float settingsFontPixels() {final float[] size={0};onMain(()->{TextView text=findTextView(activity.getWindow().getDecorView(),"Your subtitle preview");require(text!=null,"VISIBLE_SETTINGS_TEXT_REQUIRED");size[0]=text.getTextSize();});return size[0];}
  private TextView findTextView(View root,String expected){if(root instanceof TextView&&expected.contentEquals(((TextView)root).getText())&&visibleInOwnDecor(root))return (TextView)root;if(root instanceof ViewGroup){ViewGroup group=(ViewGroup)root;for(int i=0;i<group.getChildCount();i++){TextView value=findTextView(group.getChildAt(i),expected);if(value!=null)return value;}}return null;}
  private static String sha(byte[] bytes) throws Exception {byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
  private void preferenceChecks() throws Exception {
    require(TARGET.equals("org.reelm.drama.pilot")&&(fontPercent==90||fontPercent==100||fontPercent==115||fontPercent==130),"PILOT_SUPPORTED_FONT_REQUIRED");
    uiClick("Settings");waitUi("App updates",10000);uiClick("Subtitle size "+fontPercent+" percent");SystemClock.sleep(600);
    double font=library().getJSONObject("preferences").getDouble("fontScale");require(Math.abs(font-fontPercent/100.0)<.001,"PERSISTED_FONT_REQUIRED");
    stage("preferences-set","ORDINARY_OWN_SETTINGS_PERSISTED",new JSONObjectSafe().put("fontScale",font).put("librarySHA256",sha(java.nio.file.Files.readAllBytes(new java.io.File(activity.getFilesDir(),"reelm-drama-library.json").toPath()))).json);
  }
  private void openUpdateInstall() throws Exception {
    require(TARGET.equals("org.reelm.drama.pilot"),"PILOT_ONLY_INSTALL_UI");
    Class<?> type=activity.getClassLoader().loadClass("expo.modules.video.ReelmApkUpdater");Object companion=type.getField("Companion").get(null);
    Object updater=companion.getClass().getMethod("get",android.content.Context.class).invoke(companion,activity.getApplicationContext());
    require("verified".equals(((java.util.Map<?,?>)type.getMethod("status").invoke(updater)).get("state")),"PREPARED_VERIFIED_UPDATE_REQUIRED");
    String before=sha(library().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    uiClick("Settings");waitUi("App updates",10000);
    String label="Install verified APK with Android confirmation";
    for(int i=0;i<8;i++){AccessibilityNodeInfo node=uiLabel(ownUi(),label);if(node!=null&&node.isVisibleToUser())break;swipe("settings-scroll",.5f,.75f,.5f,.3f,400);SystemClock.sleep(500);}
    uiClick("Install verified APK with Android confirmation");SystemClock.sleep(2000);
    java.util.Map<?,?> status=(java.util.Map<?,?>)type.getMethod("status").invoke(updater);
    require("installing".equals(status.get("state"))||"UPDATE_PERMISSION_REQUIRED".equals(status.get("errorCode")),"NORMAL_ANDROID_INSTALL_FLOW_REQUIRED");
    require(before.equals(sha(library().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8))),"INSTALL_UI_LIBRARY_UNCHANGED_REQUIRED");
    stage("update-install-opened","ORDINARY_APP_INSTALL_BUTTON_ANDROID_CONFIRMATION_PENDING",new JSONObjectSafe().put("ordinaryInstallButton",true).put("state",status.get("state")).put("errorCode",status.get("errorCode")).put("librarySHA256",before).json);
  }
  private void updateContinuity() throws Exception {
    require(TARGET.equals("org.reelm.drama.pilot"),"PILOT_ONLY_UPDATE_FIXTURE");
    android.content.Context context=activity.getApplicationContext();ClassLoader loader=activity.getClassLoader();
    java.io.File root=new java.io.File(context.getNoBackupFilesDir(),"reelm-update-continuity"),receipt=new java.io.File(context.getNoBackupFilesDir(),"reelm-update-continuity.json");
    java.io.File libraryFile=new java.io.File(context.getFilesDir(),"reelm-drama-library.json");
    String id="00000000000000000000000000000000",resource="11111111111111111111111111111111";
    require(root.isDirectory()&&receipt.isFile()&&libraryFile.isFile()&&new java.io.File(root,"key-id").isFile()&&new java.io.File(root,id+"."+resource+".bin").isFile(),"CONTINUITY_INPUTS_REQUIRED");
    java.io.File ciphertext=new java.io.File(root,id+"."+resource+".bin");
    byte[] expected=new byte[524325];for(int i=0;i<expected.length;i++)expected[i]=(byte)(i*31);
    byte[] decoded=readContinuityFixture(root,id,resource);
    require(sha(decoded).equals(sha(expected)),"SAME_KEY_CIPHERTEXT_DECRYPT_REQUIRED");
    JSONObject actual=new JSONObject().put("librarySHA256",sha(java.nio.file.Files.readAllBytes(libraryFile.toPath()))).put("keyIdSHA256",sha(java.nio.file.Files.readAllBytes(new java.io.File(root,"key-id").toPath()))).put("ciphertextSHA256",sha(java.nio.file.Files.readAllBytes(ciphertext.toPath()))).put("plaintextSHA256",sha(decoded)).put("fontScale",library().getJSONObject("preferences").getDouble("fontScale"));
    java.util.Arrays.fill(expected,(byte)0);java.util.Arrays.fill(decoded,(byte)0);
    JSONObject current=library();stage("update-observed","READ_ONLY_POST_UPDATE_FIELDS",new JSONObjectSafe().put("continuity",actual).put("preferences",current.getJSONObject("preferences")).put("savedCount",current.getJSONArray("saved").length()).put("recentCount",current.getJSONArray("recents").length()).put("likedCount",current.getJSONArray("liked").length()).put("progressCount",current.getJSONObject("progress").length()).json);
      JSONObject original=new JSONObject(new String(java.nio.file.Files.readAllBytes(receipt.toPath()),java.nio.charset.StandardCharsets.UTF_8));
      JSONObject before=continuityJson.isEmpty()?original:new JSONObject(continuityJson);
      require(before.length()==5&&java.util.Arrays.asList(.9,1.0,1.15,1.3).contains(before.getDouble("fontScale")),"BOUNDED_CONTINUITY_CHECKPOINT_REQUIRED");
      for(String key:new String[]{"librarySHA256","keyIdSHA256","ciphertextSHA256","plaintextSHA256"})require(before.getString(key).matches("[a-f0-9]{64}"),"BOUNDED_CONTINUITY_CHECKPOINT_REQUIRED");
      for(String key:new String[]{"keyIdSHA256","ciphertextSHA256","plaintextSHA256"})require(before.getString(key).equals(original.getString(key)),"ORIGINAL_CRYPTO_CHECKPOINT_REQUIRED");
      for(java.util.Iterator<String> keys=before.keys();keys.hasNext();){String key=keys.next();require(key.equals("fontScale")?before.getDouble(key)==actual.getDouble(key):before.getString(key).equals(actual.getString(key)),"UPDATE_PRESERVE_"+key);}
      boolean checkerAbsent=false;try{loader.loadClass("expo.modules.video.ReelmNativeChecks");}catch(ClassNotFoundException expectedAbsent){checkerAbsent=true;}require(checkerAbsent,"RELEASE_NATIVE_CHECKER_MUST_BE_ABSENT");
      android.content.pm.PackageInfo installed=context.getPackageManager().getPackageInfo(TARGET,0);actual.put("installedVersionCode",android.os.Build.VERSION.SDK_INT>=28?installed.getLongVersionCode():(long)installed.versionCode).put("nativeCheckerAbsent",true);
      stage("update-preserved","LIBRARY_PREFERENCES_CIPHERTEXT_AND_KEY_PRESERVED",actual);
  }

  private byte[] readContinuityFixture(java.io.File root,String id,String resource) throws Exception {
    require(!android.system.OsConstants.S_ISLNK(android.system.Os.lstat(root.getPath()).st_mode),"CONTINUITY_ROOT_REQUIRED");
    byte[] identity=continuityBytes(root,"key-id",16);require(identity.length==16,"CONTINUITY_KEY_ID_REQUIRED");
    java.security.KeyStore keys=java.security.KeyStore.getInstance("AndroidKeyStore");keys.load(null);
    java.security.Key key=keys.getKey(TARGET+".e2e.update."+sha(identity),null);
    require(key instanceof javax.crypto.SecretKey,"CONTINUITY_KEY_REQUIRED");
    return decodeContinuityFixture(identity,(javax.crypto.SecretKey)key,continuityBytes(root,id+"."+resource+".meta",65576),continuityBytes(root,id+"."+resource+".bin",524373),id,resource);
  }
  private static byte[] continuityBytes(java.io.File root,String name,int cap) throws Exception {
    java.io.File file=new java.io.File(root,name);
    require(file.isFile()&&file.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())&&!android.system.OsConstants.S_ISLNK(android.system.Os.lstat(file.getPath()).st_mode)&&file.length()<=cap,"CONTINUITY_FILE_REQUIRED");
    byte[] bytes=new byte[(int)file.length()];try(java.io.DataInputStream input=new java.io.DataInputStream(new java.io.FileInputStream(file))){input.readFully(bytes);require(input.read()==-1,"CONTINUITY_FILE_LENGTH_REQUIRED");}return bytes;
  }
  // ponytail: immutable task9 fixture only; extend this test decoder if its fixture changes.
  private static byte[] decodeContinuityFixture(byte[] identity,javax.crypto.SecretKey key,byte[] metadata,byte[] payload,String id,String resource) throws Exception {
    require(identity.length==16&&metadata.length<=65576&&payload.length==524373,"CONTINUITY_FORMAT_REQUIRED");
    java.io.DataInputStream sealed=new java.io.DataInputStream(new java.io.ByteArrayInputStream(metadata));
    require(sealed.readInt()==0x52524d31&&sealed.readInt()==1,"CONTINUITY_FORMAT_REQUIRED");
    byte[] nonce=new byte[12];sealed.readFully(nonce);int length=sealed.readInt();require(length>=16&&length<=65552,"CONTINUITY_METADATA_LENGTH_REQUIRED");
    byte[] encrypted=new byte[length];sealed.readFully(encrypted);require(sealed.read()==-1,"CONTINUITY_TRAILING_BYTES");
    byte[] body=continuityDecrypt(key,nonce,continuityAAD(0x52524d31,identity,id,resource,-1,0),encrypted);
    try {
      java.io.DataInputStream info=new java.io.DataInputStream(new java.io.ByteArrayInputStream(body)),data=new java.io.DataInputStream(new java.io.ByteArrayInputStream(payload));
      long total=info.readLong();int count=info.readInt();require(total==524325&&count==3,"CONTINUITY_INVENTORY_REQUIRED");
      java.io.ByteArrayOutputStream decoded=new java.io.ByteArrayOutputStream((int)total);
      for(int i=0;i<count;i++) {
        int size=info.readInt();require(size==Math.min(262144,total-(long)i*262144),"CONTINUITY_CHUNK_LENGTH_REQUIRED");
        info.readFully(nonce);encrypted=new byte[size+16];data.readFully(encrypted);
        byte[] chunk=continuityDecrypt(key,nonce,continuityAAD(0x52524331,identity,id,resource,i,size),encrypted);
        try{require(chunk.length==size,"CONTINUITY_CHUNK_LENGTH_REQUIRED");decoded.write(chunk);}finally{java.util.Arrays.fill(chunk,(byte)0);}
      }
      require(info.readLong()==payload.length&&info.read()==-1&&data.read()==-1,"CONTINUITY_PAYLOAD_LENGTH_REQUIRED");return decoded.toByteArray();
    } finally {java.util.Arrays.fill(body,(byte)0);}
  }
  private static byte[] continuityAAD(int domain,byte[] identity,String id,String resource,int index,int length) throws Exception {
    java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();try(java.io.DataOutputStream output=new java.io.DataOutputStream(bytes)){output.writeInt(domain);output.writeInt(1);output.write(identity);output.writeUTF(id);output.writeUTF(resource);if(index>=0){output.writeInt(index);output.writeInt(length);}}return bytes.toByteArray();
  }
  private static byte[] continuityDecrypt(javax.crypto.SecretKey key,byte[] nonce,byte[] aad,byte[] encrypted) throws Exception {
    javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");cipher.init(javax.crypto.Cipher.DECRYPT_MODE,key,new javax.crypto.spec.GCMParameterSpec(128,nonce));cipher.updateAAD(aad);return cipher.doFinal(encrypted);
  }

  private void stageUpdateCandidate() throws Exception {
    require(TARGET.equals("org.reelm.drama.pilot"),"PILOT_ONLY_UPDATE_FIXTURE");
    android.content.Context context=activity.getApplicationContext();ClassLoader loader=activity.getClassLoader();
    java.io.File source=new java.io.File("/data/local/tmp/reelm-drama-upgrade.apk"),copy=new java.io.File(context.getNoBackupFilesDir(),"reelm-update-fixture.apk");require(source.isFile()&&!copy.exists(),"EXACT_UPGRADE_INPUT_REQUIRED");
    java.io.File libraryFile=new java.io.File(context.getFilesDir(),"reelm-drama-library.json");String before=sha(java.nio.file.Files.readAllBytes(libraryFile.toPath()));
    java.nio.file.Files.copy(source.toPath(),copy.toPath());
    android.content.pm.PackageInfo info=context.getPackageManager().getPackageArchiveInfo(copy.getPath(),0);require(info!=null,"ARCHIVE_REQUIRED");
    String tag="v"+info.versionName;
    JSONObject candidate=new JSONObject().put("releaseTag",tag).put("assetName","ReelmDrama-arm64-v8a.apk").put("url","https://github.com/azeez-d3v/reelmdrama/releases/download/"+tag+"/ReelmDrama-arm64-v8a.apk").put("bytes",copy.length()).put("sha256",sha(java.nio.file.Files.readAllBytes(copy.toPath())));
    Class<?> type=loader.loadClass("expo.modules.video.ReelmApkUpdater");Object companion=type.getField("Companion").get(null);Object updater=companion.getClass().getMethod("get",android.content.Context.class).invoke(companion,context);
    java.lang.reflect.Method accept=null;for(java.lang.reflect.Method method:type.getDeclaredMethods())if(method.getName().startsWith("acceptVerifiedFile")&&method.getParameterCount()==2)accept=method;require(accept!=null,"PRODUCT_ARCHIVE_VERIFICATION_REQUIRED");accept.setAccessible(true);accept.invoke(updater,copy,candidate);
    require("verified".equals(((java.util.Map<?,?>)type.getMethod("status").invoke(updater)).get("state")),"NATIVE_VERIFIED_CANDIDATE_REQUIRED");
    require(before.equals(sha(java.nio.file.Files.readAllBytes(libraryFile.toPath()))),"CANDIDATE_LIBRARY_UNCHANGED_REQUIRED");
    stage("update-candidate","PRODUCT_ARCHIVE_VERIFIED_WITHOUT_REPLACING_CONTINUITY_FIXTURE",new JSONObjectSafe().put("sha256",candidate.getString("sha256")).put("versionCode",android.os.Build.VERSION.SDK_INT>=28?info.getLongVersionCode():(long)info.versionCode).put("librarySHA256",before).json);
  }

  private JSONObject library() throws Exception {
    Class<?> store=activity.getClassLoader().loadClass("expo.modules.video.ReelmLibraryStore");
    Object value=store.getConstructor(java.io.File.class).newInstance(new java.io.File(activity.getFilesDir(),"reelm-drama-library.json"));
    return new JSONObject((String)store.getMethod("read").invoke(value));
  }
  private void settingsChecks() throws Exception {
    // Ordinary timeline press requests32 seconds while paused; independent file read proves save.
    final float[] point=new float[2];JSONObject nativeTime=nativeSnapshot();double duration=nativeTime.getLong("durationMs")/1000.0;
    require(duration>32,"RESUME_TEST_REQUIRES_DURATION_OVER32");
    onMain(()->{ownWindow();View d=activity.getWindow().getDecorView(),v=findLabel(d,"Playback timeline");require(v!=null,"TIMELINE_REQUIRED");int[] a=new int[2],b=new int[2];v.getLocationOnScreen(a);d.getLocationOnScreen(b);point[0]=a[0]-b[0]+v.getWidth()*(float)(32.0/duration);point[1]=a[1]-b[1]+v.getHeight()/2f;});
    long down=SystemClock.uptimeMillis();dispatch(MotionEvent.ACTION_DOWN,point[0],point[1],down);SystemClock.sleep(90);dispatch(MotionEvent.ACTION_UP,point[0],point[1],down);SystemClock.sleep(1000);
    long seekDeadline=SystemClock.uptimeMillis()+20000;JSONObject seekSample=nativeSnapshot();while((seekSample.getInt("playbackState")!=3||Math.abs(seekSample.getLong("positionMs")-32000)>1000)&&SystemClock.uptimeMillis()<seekDeadline){SystemClock.sleep(250);seekSample=nativeSnapshot();}require(seekSample.getInt("playbackState")==3&&Math.abs(seekSample.getLong("positionMs")-32000)<=1000,"PAUSED32_READY_SETUP_REQUIRED");SystemClock.sleep(1200);stage("saved32-native-paused","INDEPENDENT_NATIVE_GETTERS_AND_OWN_TIMELINE",nativeSnapshot());
    tapLabel("Back to catalogue");require(waitLabel("Settings",5000),"SETTINGS_TAB_REQUIRED");tapLabel("Settings");SystemClock.sleep(600);
    for(String value:new String[]{"1.25","1.5","1.75","2"}) {tapLabel("Hold speed "+value+" times");SystemClock.sleep(500);double actual=library().getJSONObject("preferences").getDouble("holdSpeed");require(Math.abs(actual-Double.parseDouble(value))<.001,"PERSISTED_SPEED_MISMATCH");stage("settings-speed","REAL_OWN_TAP_AND_NATIVE_ATOMIC_FILE",new JSONObjectSafe().put("holdSpeed",actual).json);}
    tapLabel("Subtitle size 100 percent");SystemClock.sleep(300);float basePixels=settingsFontPixels();
    for(int value:new int[]{90,100,115,130}) {tapLabel("Subtitle size "+value+" percent");SystemClock.sleep(500);double actual=library().getJSONObject("preferences").getDouble("fontScale");require(Math.abs(actual-value/100.0)<.001,"PERSISTED_FONT_MISMATCH");stage("settings-font","REAL_OWN_TAP_AND_NATIVE_ATOMIC_FILE",new JSONObjectSafe().put("fontScale",actual).put("actualTextSizePx",settingsFontPixels()).put("baseTextSizePx",basePixels).json);require(Math.abs(settingsFontPixels()/basePixels-actual)<.03,"NATIVE_TEXT_SIZE_SCALE_MISMATCH");}
    JSONObject file=library();stage("settings-complete","NATIVE_PERSISTED_LOCAL_SETTINGS",new JSONObjectSafe().put("preferences",file.getJSONObject("preferences")).put("recentCount",file.getJSONArray("recents").length()).json);
    // Return130% to the user-selected default after proving every choice.
    tapLabel("Subtitle size 100 percent");tapLabel("Hold speed 1.5 times");SystemClock.sleep(500);
  }
  private Object invoke(Object target, String method) throws Exception {
    java.lang.reflect.Method m = target.getClass().getMethod(method); m.setAccessible(true); return m.invoke(target);
  }
  private Object ownPlayer(View root) throws Exception {
    if (visibleInOwnDecor(root) && root.getClass().getName().equals("androidx.media3.ui.PlayerView")) {
      Object player = invoke(root, "getPlayer"); if (player != null) return player;
    }
    if (root instanceof ViewGroup) { ViewGroup group = (ViewGroup)root;
      for (int i=0;i<group.getChildCount();i++) {Object player=ownPlayer(group.getChildAt(i)); if(player!=null)return player;}
    } return null;
  }
  private JSONObject nativeSnapshot() {
    final JSONObject[] result = {null};
    onMain(() -> {ownWindow(); try {
      View decor = activity.getWindow().getDecorView(); Object player = ownPlayer(decor);
      require(player != null, "VISIBLE_NATIVE_PLAYER_REQUIRED");
      Object parameters = invoke(player, "getPlaybackParameters");
      Object counters = invoke(player, "getVideoDecoderCounters");
      require(counters != null, "NATIVE_DECODER_COUNTERS_REQUIRED"); invoke(counters, "ensureUpdated");
      View timeline = findLabel(decor, "Playback timeline");
      JSONArray texts = new JSONArray(); if(timeline!=null)collectTexts(timeline,texts);
      Object media=invoke(player,"getCurrentMediaItem");String mediaHost="",mediaScheme="";if(media!=null){Object config=media.getClass().getField("localConfiguration").get(media);if(config!=null){Uri uri=(Uri)config.getClass().getField("uri").get(config);mediaHost=uri.getHost()==null?"":uri.getHost();mediaScheme=uri.getScheme();}}
      result[0] = new JSONObject().put("currentMediaHost",mediaHost).put("currentMediaScheme",mediaScheme).put("positionMs", invoke(player,"getCurrentPosition"))
        .put("durationMs",invoke(player,"getDuration")).put("playing",invoke(player,"isPlaying"))
        .put("playWhenReady",invoke(player,"getPlayWhenReady"))
        .put("playbackState",invoke(player,"getPlaybackState"))
        .put("rate",parameters.getClass().getField("speed").get(parameters))
        .put("renderedOutputBufferCount",counters.getClass().getField("renderedOutputBufferCount").get(counters))
        .put("nativePlayerIdentity",System.identityHashCode(player))
        .put("timelineVisible",timeline!=null).put("timecodes",texts);
    } catch(ProbeFailure failure){throw failure;} catch(Exception failure){throw new ProbeFailure("NATIVE_GETTER_FAILED_"+failure.getClass().getSimpleName());}});
    return result[0];
  }
  private void collectTexts(View root, JSONArray texts) {
    if(root instanceof TextView)texts.put(((TextView)root).getText().toString());
    if(root instanceof ViewGroup){ViewGroup group=(ViewGroup)root;for(int i=0;i<group.getChildCount();i++)collectTexts(group.getChildAt(i),texts);}
  }
  private boolean waitNativePlaying(long timeout) {
    long end=SystemClock.uptimeMillis()+timeout;
    while(SystemClock.uptimeMillis()<end){try{if(nativeSnapshot().optBoolean("playing"))return true;}catch(ProbeFailure failure){}SystemClock.sleep(250);}return false;
  }
  private void observe(String name,long duration) {
    long end=SystemClock.uptimeMillis()+duration;
    do {stage(name,"INDEPENDENT_NATIVE_GETTERS_AND_OWN_TIMELINE",nativeSnapshot());SystemClock.sleep(250);}while(SystemClock.uptimeMillis()<end);
  }
  private float[] surfacePoint() {
    final float[] point=new float[2];
    onMain(()->{ownWindow();View d=activity.getWindow().getDecorView();point[0]=d.getWidth()*.42f;point[1]=d.getHeight()*.42f;});return point;
  }
  private void tapSurface() {
    float[] point=surfacePoint();long down=SystemClock.uptimeMillis();boolean first=dispatch(MotionEvent.ACTION_DOWN,point[0],point[1],down);SystemClock.sleep(90);boolean last=dispatch(MotionEvent.ACTION_UP,point[0],point[1],down);
    stage("surface-tap","OWN_DECOR_MOTIONEVENT_DISPATCHED",new JSONObjectSafe().point(point[0],point[1]).flags(first,last).json);SystemClock.sleep(350);
  }
  private void hold(long duration) {
    float[] point=surfacePoint();long down=SystemClock.uptimeMillis();boolean first=dispatch(MotionEvent.ACTION_DOWN,point[0],point[1],down);
    stage("hold-down","OWN_DECOR_MOTIONEVENT_DISPATCHED",new JSONObjectSafe().point(point[0],point[1]).put("downHandled",first).json);
    observe("held",duration);
    boolean last=dispatch(MotionEvent.ACTION_UP,point[0],point[1],down);
    stage("hold-up","OWN_DECOR_MOTIONEVENT_DISPATCHED",new JSONObjectSafe().point(point[0],point[1]).put("upHandled",last).duration(SystemClock.uptimeMillis()-down).json);
  }

  private void onMain(final Runnable action) {
    final Throwable[] failure = {null};
    final CountDownLatch complete = new CountDownLatch(1);
    final AtomicBoolean permitted = new AtomicBoolean(true);
    final Handler handler = new Handler(Looper.getMainLooper());
    final Runnable posted = () -> {
      try { if (permitted.get()) action.run(); }
      catch (Throwable exception) { failure[0] = exception; }
      finally { complete.countDown(); }
    };
    require(handler.post(posted), "OWN_MAIN_THREAD_POST_REJECTED");
    try {
      if (!complete.await(MAIN_OPERATION_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
        permitted.set(false); handler.removeCallbacks(posted);
        throw new ProbeFailure("OWN_MAIN_THREAD_OPERATION_TIMEOUT");
      }
    } catch (InterruptedException interrupted) {
      permitted.set(false); handler.removeCallbacks(posted);
      Thread.currentThread().interrupt();
      throw new ProbeFailure("OWN_MAIN_THREAD_WAIT_INTERRUPTED");
    }
    if (failure[0] != null) throw failure[0] instanceof ProbeFailure ? (ProbeFailure)failure[0]
        : new ProbeFailure("OWN_MAIN_THREAD_OPERATION_FAILED");
  }
  private boolean waitOwnFocus(long timeout) {
    long end = SystemClock.uptimeMillis() + timeout;
    while (SystemClock.uptimeMillis() < end) {
      final boolean[] focused = {false};
      onMain(() -> {require(activity != null && !activity.isFinishing() && !activity.isDestroyed()
          && TARGET.equals(activity.getPackageName()) && ACTIVITY.equals(activity.getClass().getName()),
          "EXACT_OWN_ACTIVITY_REQUIRED");focused[0] = activity.hasWindowFocus();});
      if (focused[0]) return true;
      SystemClock.sleep(250);
    }
    return false;
  }
  private long dispatchWarmWhenOwnReady(final Intent warm, long timeout) {
    long end = SystemClock.uptimeMillis() + timeout;
    while (SystemClock.uptimeMillis() < end) {
      final long[] dispatchedAt = {0};
      onMain(() -> {
        require(activity != null && !activity.isFinishing() && !activity.isDestroyed()
            && TARGET.equals(activity.getPackageName()) && ACTIVITY.equals(activity.getClass().getName()),
            "EXACT_OWN_ACTIVITY_REQUIRED");
        if (!activity.hasWindowFocus()) return;
        ownWindow(); View decor = activity.getWindow().getDecorView();
        boolean ready = findText(decor, "REELM") || findLabel(decor, "Pause episode") != null || findLabel(decor, "Play episode") != null
            || findLabel(decor, "Show playback controls") != null;
        if (!ready) return;
        // Readiness and this single normal intent dispatch share one UI-thread
        // callback. Loading-modal focus transitions cause another bounded wait,
        // never an action against another window or relaxed touch guard.
        dispatchedAt[0] = System.currentTimeMillis();
        activity.startActivity(warm);
      });
      if (dispatchedAt[0] > 0) return dispatchedAt[0];
      SystemClock.sleep(250);
    } return 0;
  }
  private void ownWindow() {
    require(activity != null && !activity.isFinishing() && !activity.isDestroyed()
        && TARGET.equals(activity.getPackageName()) && ACTIVITY.equals(activity.getClass().getName())
        && activity.hasWindowFocus(), "OWN_ACTIVITY_WINDOW_FOCUS_REQUIRED");
    View decor = activity.getWindow().getDecorView();
    require(decor != null && decor.isShown() && decor.getWidth() > 0 && decor.getHeight() > 0,
        "OWN_DECOR_VISIBLE_REQUIRED");
  }
  private View findLabel(View root, String expected) {
    if (visibleInOwnDecor(root) && root.isEnabled()
        && root.getContentDescription() != null && expected.contentEquals(root.getContentDescription())) return root;
    if (root instanceof ViewGroup) { ViewGroup group = (ViewGroup)root;
      for (int i = 0; i < group.getChildCount(); i++) { View found = findLabel(group.getChildAt(i), expected); if (found != null) return found; }
    } return null;
  }
  private boolean findText(View root, String expected) {
    if (visibleInOwnDecor(root) && root instanceof TextView && expected.contentEquals(((TextView)root).getText())) return true;
    if (root instanceof ViewGroup) { ViewGroup group = (ViewGroup)root;
      for (int i = 0; i < group.getChildCount(); i++) if (findText(group.getChildAt(i), expected)) return true;
    } return false;
  }
  private boolean visibleInOwnDecor(View view) {
    // isShown() alone includes mounted FlatList neighbors outside the viewport.
    // Global visible bounds include real ancestor clipping; no guessed inset or
    // offscreen label can stand in for the currently visible episode/control.
    if (!view.isShown() || view.getWidth() <= 0 || view.getHeight() <= 0) return false;
    View ancestor = view;
    while (ancestor != null) {
      if (ancestor.getAlpha() < .05f || ancestor.getVisibility() != View.VISIBLE) return false;
      ancestor = ancestor.getParent() instanceof View ? (View)ancestor.getParent() : null;
    }
    Rect visible = new Rect(), decorVisible = new Rect();
    View decor = activity.getWindow().getDecorView();
    if (!view.getGlobalVisibleRect(visible) || !decor.getGlobalVisibleRect(decorVisible)
        || !visible.intersect(decorVisible)) return false;
    int[] point = new int[2];view.getLocationOnScreen(point);
    int centerX = point[0] + view.getWidth() / 2, centerY = point[1] + view.getHeight() / 2;
    return visible.contains(centerX, centerY)
        && visible.width() >= view.getWidth() * .8f
        && visible.height() >= view.getHeight() * .8f;
  }
  private boolean labelExists(final String expected) {
    final boolean[] exists = {false};onMain(() -> {ownWindow();exists[0] = findLabel(activity.getWindow().getDecorView(), expected) != null;});return exists[0];
  }
  private boolean waitLabel(String expected, long timeout) {
    long end = SystemClock.uptimeMillis() + timeout;
    while (SystemClock.uptimeMillis() < end) {
      // An owned RN loading modal may temporarily hold window focus. Waiting
      // tolerates that state without inspecting/dispatching into another window.
      final boolean[] exists = {false}, reveal = {false};
      onMain(() -> {
        require(activity != null && !activity.isFinishing() && !activity.isDestroyed()
            && TARGET.equals(activity.getPackageName()) && ACTIVITY.equals(activity.getClass().getName()),
            "EXACT_OWN_ACTIVITY_REQUIRED");
        if (!activity.hasWindowFocus()) return;
        ownWindow(); View decor = activity.getWindow().getDecorView();
        exists[0] = findLabel(decor, expected) != null;
        reveal[0] = !exists[0] && findLabel(decor, "Show playback controls") != null;
      });
      if (exists[0]) return true;
      if (reveal[0]) tapLabel("Show playback controls");
      SystemClock.sleep(250);
    } return false;
  }
  private boolean waitText(final String expected, long timeout) {
    long end = SystemClock.uptimeMillis() + timeout;
    while (SystemClock.uptimeMillis() < end) {final boolean[] exists = {false};onMain(() -> {ownWindow();exists[0] = findText(activity.getWindow().getDecorView(), expected);});if (exists[0]) return true;revealIfHidden();SystemClock.sleep(250);}return false;
  }
  private boolean dispatch(int action, float x, float y, long downTime) {
    final boolean[] handled = {false};onMain(() -> {ownWindow();View decor = activity.getWindow().getDecorView();require(x >= 0 && y >= 0 && x < decor.getWidth() && y < decor.getHeight(), "OWN_WINDOW_COORDINATE_BOUNDS");MotionEvent motion = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0);motion.setSource(InputDevice.SOURCE_TOUCHSCREEN);try {handled[0] = decor.dispatchTouchEvent(motion);} finally {motion.recycle();}});return handled[0];
  }
  private void tapLabel(final String expected) {
    if (!"Show playback controls".equals(expected)) revealIfHidden();
    final float[] point = new float[2];onMain(() -> {ownWindow();View decor = activity.getWindow().getDecorView(),target = findLabel(decor, expected);require(target != null, "EXACT_VISIBLE_ACCESSIBILITY_TARGET_REQUIRED");int[] t = new int[2],d = new int[2];target.getLocationOnScreen(t);decor.getLocationOnScreen(d);point[0] = t[0] - d[0] + target.getWidth() / 2f;point[1] = t[1] - d[1] + target.getHeight() / 2f;});long down = SystemClock.uptimeMillis();boolean first = dispatch(MotionEvent.ACTION_DOWN, point[0], point[1], down);SystemClock.sleep(90);boolean last = dispatch(MotionEvent.ACTION_UP, point[0], point[1], down);stage("tap", "OWN_DECOR_MOTIONEVENT_DISPATCHED", new JSONObjectSafe().point(point[0],point[1]).flags(first,last).label(expected).json);
  }
  private void revealIfHidden() {if (labelExists("Show playback controls")) {tapLabel("Show playback controls");SystemClock.sleep(300);stage("reveal", "OWN_REVEAL_CONTROL_DISPATCHED", null);}}
  private void swipe(String label, float fromX, float fromY, float toX, float toY, long duration) {
    final int[] size = new int[2];onMain(() -> {ownWindow();View d = activity.getWindow().getDecorView();size[0]=d.getWidth();size[1]=d.getHeight();});float sx=size[0]*fromX,sy=size[1]*fromY,ex=size[0]*toX,ey=size[1]*toY;long down=SystemClock.uptimeMillis();boolean first=dispatch(MotionEvent.ACTION_DOWN,sx,sy,down);int handledMoves=0,steps=22;for(int i=1;i<=steps;i++){SystemClock.sleep(duration/steps);float part=i/(float)steps;if(dispatch(MotionEvent.ACTION_MOVE,sx+(ex-sx)*part,sy+(ey-sy)*part,down))handledMoves++;}boolean last=dispatch(MotionEvent.ACTION_UP,ex,ey,down);stage(label,"OWN_DECOR_SWIPE_EVENTS_DISPATCHED",new JSONObjectSafe().point(sx,sy).end(ex,ey).flags(first,last).moves(steps,handledMoves).duration(SystemClock.uptimeMillis()-down).json);
  }
  private void stage(String name, String outcome, JSONObject data) {
    try {JSONObject row=new JSONObject().put("stage",name).put("outcome",outcome).put("deviceTimeMs",System.currentTimeMillis()).put("uptimeMs",SystemClock.uptimeMillis()).put("ownPackage",TARGET).put("ownActivity",ACTIVITY).put("dispatchOnly",true);if(data!=null)row.put("dispatch",data);rows.put(row);Bundle status=new Bundle();status.putString("probeStage",row.toString());sendStatus(0,status);}catch(Throwable ignored){throw new ProbeFailure("STAGE_SERIALIZATION_ERROR");}
  }
  private static void require(boolean value,String code){if(!value)throw new ProbeFailure(code);}
  private static final class ProbeFailure extends RuntimeException{ProbeFailure(String code){super(code);}}
  private static final class JSONObjectSafe {
    final JSONObject json=new JSONObject();JSONObjectSafe put(String key,Object value){try{json.put(key,value);}catch(Throwable e){throw new ProbeFailure("DISPATCH_SERIALIZATION_ERROR");}return this;}
    JSONObjectSafe point(float x,float y){return put("startX",x).put("startY",y);}JSONObjectSafe end(float x,float y){return put("endX",x).put("endY",y);}JSONObjectSafe flags(boolean first,boolean last){return put("downHandled",first).put("upHandled",last);}JSONObjectSafe label(String label){return put("fixedOwnAccessibilityLabel",label);}JSONObjectSafe moves(int count,int handled){return put("moveEvents",count).put("handledMoveEvents",handled);}JSONObjectSafe duration(long duration){return put("actualGestureDurationMs",duration);}
  }
}
