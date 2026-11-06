import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { size } from './metrics';

export type ScreenProps = {
  children: ReactNode;
  /** Fixed above the content (an `AppBar`, an `OfflineBanner`). */
  header?: ReactNode;
  /** Buttons for the fixed bottom bar (ground colour, hairline above, safe area below; app.css `.bottom-bar`). */
  footer?: ReactNode;
  /** A `<Fab>`: placed bottom right, and the content pads past it. */
  fab?: ReactNode;
  /** The screen sits above the tab bar, which already covers the bottom safe area. */
  tabs?: boolean;
  /** `false` for content that manages its own scrolling (a FlatList); it still gets the gutter. */
  scroll?: boolean;
};

/**
 * Every screen's frame: the ground colour, the top safe area, one 16 px gutter, and bottom padding so the last card
 * clears the home indicator, the tab bar or the FAB (specs § 3.1). The keyboard pushes the content and FAB up.
 * A screen that shows the tab bar outside the tabs navigator renders `<TabBar>` as a sibling below `<Screen tabs>`.
 */
export function Screen({ children, header, footer, fab, tabs, scroll = true }: ScreenProps) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = tabs || footer ? 0 : insets.bottom;
  const padBottom = bottomInset + (fab ? space.s10 * 2 + space.s4 : space.s8); // 96 px past a FAB, else 32 px (app.css `.scroll`)
  const body = { paddingHorizontal: space.s4, paddingBottom: padBottom };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ground, paddingTop: insets.top }}>
      {header}
      {scroll ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, body]}>{children}</View>
      )}
      {footer && (
        <View
          style={{
            flexDirection: 'row',
            gap: space.s3,
            paddingTop: space.s3,
            paddingHorizontal: space.s4,
            paddingBottom: insets.bottom + space.s3,
            backgroundColor: colors.ground,
            borderTopWidth: size.hairline,
            borderTopColor: colors.hair,
          }}
        >
          {footer}
        </View>
      )}
      {fab && <View style={{ position: 'absolute', right: space.s4, bottom: bottomInset + space.s4 }}>{fab}</View>}
    </KeyboardAvoidingView>
  );
}
