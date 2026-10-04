import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {PixelRatio, View, useWindowDimensions, type ViewProps} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {E2E_ENABLED, getTestRun, record} from '../diagnostics';
import {normalizeNativeBounds, validNativeRectangle, type NativeRectangle} from './coordinates';

type MeasuredView = 'home' | 'platform' | 'watch' | 'detail' | 'episodes';
type MeasurementContextValue = {view: MeasuredView; variant: string};
const Context = createContext<MeasurementContextValue>({view: 'home', variant: ''});
type RootCalibration = NativeRectangle & {id: string; measuredAt: string; capturedRun: string};
const RootContext = createContext<RootCalibration | null>(null);
export function MeasurementProvider({view, variant, children}: MeasurementContextValue & {children: ReactNode}) {
  const value = useMemo(() => ({view, variant}), [view, variant]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function NativeMeasurementRoot({calibrationId, onLayout, children, ...props}: ViewProps & {calibrationId: string}) {
  const ref = useRef<View>(null), alive = useRef(true), pending = useRef<number | null>(null);
  const [calibration, setCalibration] = useState<RootCalibration | null>(null);
  const screen = useWindowDimensions(), run = E2E_ENABLED ? getTestRun() : '';
  const measure = useCallback(() => {
    if (!E2E_ENABLED || !alive.current) return;
    if (pending.current !== null) cancelAnimationFrame(pending.current);
    const capturedRun = getTestRun();
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      ref.current?.measureInWindow((x, y, width, height) => {
        if (!alive.current || capturedRun !== getTestRun() || !validNativeRectangle({x, y, width, height})) return;
        const observed = {id: calibrationId, x, y, width, height, measuredAt: new Date().toISOString(), capturedRun};
        setCalibration(previous => previous && previous.id === calibrationId && previous.x === x && previous.y === y && previous.width === width && previous.height === height && previous.capturedRun === capturedRun ? previous : observed);
      });
    });
  }, [calibrationId, screen.width, screen.height]);
  useEffect(() => {measure();}, [measure, run]);
  useEffect(() => {alive.current = true;return () => {alive.current = false;if (pending.current !== null) cancelAnimationFrame(pending.current);};}, []);
  return <View {...props} ref={ref} collapsable={!E2E_ENABLED} onLayout={event => {onLayout?.(event);measure();}}><RootContext.Provider value={calibration}>{children}</RootContext.Provider></View>;
}

export function useNativeMeasurement(id: string | undefined, {interactive = false, safeAreaRequired = false}: {interactive?: boolean; safeAreaRequired?: boolean} = {}) {
  const ref = useRef<View>(null), alive = useRef(true), pending = useRef<number | null>(null), last = useRef('');
  const context = useContext(Context), root = useContext(RootContext), insets = useSafeAreaInsets();
  const run = E2E_ENABLED ? getTestRun() : '';
  const measure = useCallback(() => {
    if (!E2E_ENABLED || !id || !alive.current || !root) return;
    if (pending.current !== null) cancelAnimationFrame(pending.current);
    const capturedRun = getTestRun();
    if (root.capturedRun !== capturedRun) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      ref.current?.measureInWindow((x, y, width, height) => {
        if (!alive.current || capturedRun !== getTestRun()) return;
        const nativeBounds = {x, y, width, height}, normalized = normalizeNativeBounds(nativeBounds, root);
        if (!normalized) return;
        const bounds = {id, ...normalized, safeAreaRequired, interactive};
        const signature = JSON.stringify([capturedRun, context.view, context.variant, bounds, root.id, root.x, root.y, root.width, root.height, insets]);
        if (signature === last.current) return;
        last.current = signature;
        record('layoutMeasured', {runId: capturedRun, capturedRun, view: context.view, coordinateSpace: 'window', window: {width: root.width, height: root.height}, pixelRatio: PixelRatio.get(), safeAreaInsets: {top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right}, bounds: [bounds], calibration: {method: 'measureInWindow', origin: 'measured-native-root', rootId: root.id, root: {x: root.x, y: root.y, width: root.width, height: root.height}, rootMeasuredAt: root.measuredAt, rootCapturedRun: root.capturedRun, nativeChildBounds: nativeBounds, transformation: 'child-native-origin-minus-observed-root-origin'}});
      });
    });
  }, [id, interactive, safeAreaRequired, context.view, context.variant, root, insets.top, insets.bottom, insets.left, insets.right]);
  useEffect(() => {measure();}, [measure, run]);
  useEffect(() => {alive.current = true;return () => {alive.current = false;if (pending.current !== null) cancelAnimationFrame(pending.current);};}, []);
  return {ref, onLayout: measure, collapsable: !E2E_ENABLED};
}
