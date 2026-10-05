import React,{createContext,forwardRef,useContext} from 'react';
import {Text,TextInput,StyleSheet,type TextProps,type TextInputProps,type TextStyle,type StyleProp} from 'react-native';
import {normalizePreferences} from '../library-policy';
export const FontScaleContext=createContext(1);
export function scaledStyle(style:StyleProp<TextStyle>,scale:number):TextStyle{const s=StyleSheet.flatten(style)||{};const valid=normalizePreferences({fontScale:scale}).fontScale;return {...s,fontSize:(typeof s.fontSize==='number'?s.fontSize:14)*valid,...(typeof s.lineHeight==='number'?{lineHeight:s.lineHeight*valid}:{})};}
export const ScaledText=forwardRef<Text,TextProps>(function ScaledText({style,...props},ref){const scale=useContext(FontScaleContext);return <Text {...props} ref={ref} style={scaledStyle(style,scale)}/>;});
export const ScaledTextInput=forwardRef<TextInput,TextInputProps>(function ScaledTextInput({style,...props},ref){const scale=useContext(FontScaleContext);return <TextInput {...props} ref={ref} style={scaledStyle(style,scale)}/>;});
