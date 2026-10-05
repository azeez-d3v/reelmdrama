import {requireNativeModule} from 'expo';
import type {UpdateCandidate,UpdateStatus} from './updates';
export type InstalledVersion = {packageName: string; versionName: string; versionCode: number; certificateSHA256: string;updateTrusted:boolean};
export const native = requireNativeModule<{
  reelmReadLibraryJson(): Promise<string | null>;
  reelmWriteLibraryJsonAtomic(body: string): Promise<void>;
  reelmGetInstalledVersion(): Promise<InstalledVersion>;
  reelmExportLibrary(body:string):Promise<boolean>;
  reelmImportLibrary():Promise<string|null>;
  reelmDownloadUpdate(candidate:UpdateCandidate):Promise<void>;
  reelmCancelUpdate():Promise<void>;
  reelmGetUpdateStatus():Promise<UpdateStatus>;
  reelmInstallVerifiedUpdate():Promise<void>;
}>('ExpoVideo');
