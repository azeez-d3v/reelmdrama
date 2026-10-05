import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,byID,nodes} from './ui-harness.mjs';
import * as theme from '../theme.ts';
import {formatTime,safeInset} from '../ui/format.ts';

test('Library collection tabs stay adjacent, wrap and preserve Saved/Recents callbacks',()=>{
  const h=componentHarness('../ui/CatalogueScreen.tsx',{'./ScaledText':{ScaledText:'Text',ScaledTextInput:'TextInput'},
    'react-native':{FlatList:'FlatList',Image:'Image',RefreshControl:'RefreshControl',ScrollView:'ScrollView',useWindowDimensions:()=>({width:360})},
    '../theme':theme,'./Icon':{Icon:'Icon'},'./Navigation':{BrandedHeader:'Header',BottomTabs:'Tabs'},
    './Primitives':{ActionButton:'ActionButton',IconButton:'IconButton',StatePanel:'Panel'},'./format':{formatTime,safeInset},
    './measurement':{MeasurementProvider:'Measurements'},'./Motion':{useAppActive:()=>true}});
  const chosen=[];
  try{
    const props={tab:'saved',collection:'saved',items:[],platforms:[],savedIds:new Set(),insets:{top:24,bottom:24,left:0,right:0},
      onCollectionChange:value=>chosen.push(value),onTabChange(){},onQueryChange(){},total:2};
    for(const collection of ['saved','recents','saved']){
      const tree=h.render('CatalogueScreen',{...props,collection});
      const header=byID(tree,'catalogue-grid').props.ListHeaderComponent;
      const saved=byID(header,'library-saved'),recents=byID(header,'library-recents');
      const row=nodes(header).find(n=>n.props.children?.flat(Infinity).includes(saved)&&n.props.children?.flat(Infinity).includes(recents));
      assert(row);assert.equal(row.props.style.flexDirection,'row');assert.equal(row.props.style.justifyContent,'flex-start');
      assert.equal(row.props.style.gap,12);assert.equal(row.props.style.flexWrap,'wrap');
      saved.props.onPress();recents.props.onPress();assert.deepEqual(chosen.splice(0),['saved','recents']);
      assert.equal(saved.props.tone,'secondary','Library label foreground must stay stable across selection');
      assert.equal(recents.props.tone,'secondary');
      for(const [button,value] of [[saved,'saved'],[recents,'recents']]){
        assert.equal(button.props.selected,collection===value);
        assert.equal(button.props.style?.borderColor,collection===value?theme.colors.signal:undefined);
      }
      const heading=byID(header,'catalogue-collection-heading');
      const headingRow=nodes(header).find(n=>n.props.children?.includes(heading));
      assert.equal(headingRow.props.style.justifyContent,'space-between','title/count heading must remain unchanged');
    }
  }finally{h.cleanup();}
});

test('ActionButton exposes optional selection without changing tonal label, gestures or other callers',()=>{
  const press=()=>{},feedback={scale:1,onPressIn(){},onPressOut(){}};
  const h=componentHarness('../ui/Primitives.tsx',{'react-native':{Animated:{View:'AnimatedView'}},
    './ScaledText':{ScaledText:'Text'},'../theme':theme,'./Icon':{Icon:'Icon'},
    './measurement':{useNativeMeasurement:()=>({})},'./Motion':{LoadingSignal:'Loading',usePressFeedback:()=>feedback}});
  try{
    for(const selected of [true,false,true,undefined]){
      const tree=h.render('ActionButton',{label:'Saved',tone:'secondary',selected,onPress:press});
      assert.equal(tree.props.accessibilityState.selected,selected);
      assert.equal(tree.props.accessibilityState.disabled,false);
      assert.equal(tree.props.onPress,press);assert.equal(tree.props.onPressIn,feedback.onPressIn);assert.equal(tree.props.onPressOut,feedback.onPressOut);
      const label=nodes(tree).find(n=>n.type==='Text');
      assert.equal(label.props.children[0],'Saved');assert.equal(label.props.key,undefined,'do not remount labels');
      assert.equal(Object.assign({},...label.props.style.filter(Boolean)).color,theme.colors.text);
      assert.equal(Object.assign({},...tree.props.style({pressed:false}).filter(Boolean)).minHeight,48);
    }
  }finally{h.cleanup();}
});
