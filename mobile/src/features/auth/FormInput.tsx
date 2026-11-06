import { Controller, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { PasswordField } from '../../ui/PasswordField';
import { TextField, type TextFieldProps } from '../../ui/TextField';

type Props<T extends FieldValues> = Omit<TextFieldProps, 'value' | 'ref'> & {
  form: UseFormReturn<T>;
  name: Path<T>;
  /** A `PasswordField` (with the eye) instead of a `TextField`. */
  password?: boolean;
  /** Fields to check again when this one changes (the confirmation, once the password moves), if they hold text. */
  revalidate?: Path<T>[];
};

/**
 * A kit `TextField` / `PasswordField` wired to a react-hook-form field: the value, the blur and change events, the
 * schema's message as the error line, and the field's ref so a failed submit focuses the first invalid one (specs § 3.3).
 * An `error` passed in (a "taken" hint) shows when the schema has no complaint.
 */
export function FormInput<T extends FieldValues>({ form, name, password, revalidate, error, onChangeText, onBlur, ...props }: Props<T>) {
  const Input = password ? PasswordField : TextField;
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Input
          {...props}
          ref={field.ref}
          value={String(field.value ?? '')}
          error={fieldState.error?.message ?? error}
          onChangeText={(text) => {
            field.onChange(text);
            onChangeText?.(text);
            for (const other of revalidate ?? []) if (form.getValues(other)) void form.trigger(other);
          }}
          onBlur={(e) => {
            field.onBlur();
            onBlur?.(e);
          }}
        />
      )}
    />
  );
}
