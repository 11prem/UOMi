import { useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from './IconButton';
import { TextField, type TextFieldProps } from './TextField';

/** A `TextField` with the show/hide eye (specs § 3.3). Pass `autoComplete="current-password"` or `"new-password"`. */
export function PasswordField(props: Omit<TextFieldProps, 'secureTextEntry' | 'right'>) {
  const { colors } = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      secureTextEntry={!shown}
      right={
        <IconButton
          icon={shown ? 'eyeoff' : 'eye'}
          iconSize="sm"
          color={colors.ink2}
          label={shown ? 'Hide password' : 'Show password'}
          onPress={() => setShown((s) => !s)}
        />
      }
    />
  );
}
