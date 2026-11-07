import { StyleSheet, Text, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Fab } from '../Fab';
import { MemberPlate } from '../MemberPlate';
import { OtpInput } from '../OtpInput';
import { Stamp } from '../Stamp';
import { TextField } from '../TextField';
import { COUNTRIES } from '../../domain/phone';
import { PhoneField } from '../../features/auth/PhoneField';

// Screens always put kit parts inside a host view; RNTL's label queries miss a TextInput whose only host ancestor is the field.
const inTheme = (ui: React.ReactElement) =>
  render(
    <ThemeProvider>
      <View>{ui}</View>
    </ThemeProvider>,
  );
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) ?? {};
/** Host elements of one native type (`Image`, `RNSVGSvgView` for an Icon). */
const hosts = (type: string) => screen.container.queryAll((n) => n.type === type);
/** The kit Spinner: the ring with its open quarter. */
const spinners = () => screen.container.queryAll((n) => n.type === 'View' && flat(n).borderRightColor === 'transparent');

describe('Stamp', () => {
  it.each(['AGREED', 'RECEIVED', 'REJECTED', 'NOT RECEIVED'])('%s stays on one line', async (label) => {
    await inTheme(<Stamp label={label} />);
    expect(screen.getByText(label).props.numberOfLines).toBe(1);
  });

  // Widths measured from Fraunces-Text-Bold at 12 px with 0.12em tracking: AGREED 62.6, NOT RECEIVED 113.5.
  it('keeps 12 px lettering that fits the 80 px stamp and shrinks only a wider label', async () => {
    const measure = async (label: string, width: number) => {
      const measurer = screen.getAllByText(label, { includeHiddenElements: true }).find((t) => t.props.onLayout)!;
      await fireEvent(measurer, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 14 } } });
    };

    const { rerender } = await inTheme(<Stamp label="AGREED" />);
    await measure('AGREED', 62.6);
    expect(flat(screen.getByText('AGREED')).fontSize).toBe(12);

    await rerender(
      <ThemeProvider>
        <View>
          <Stamp label="NOT RECEIVED" red />
        </View>
      </ThemeProvider>,
    );
    await measure('NOT RECEIVED', 113.5);
    const style = flat(screen.getByText('NOT RECEIVED'));
    expect(style.fontSize).toBeCloseTo((12 * 80) / 113.5, 5);
    expect(screen.getByText('NOT RECEIVED').props.numberOfLines).toBe(1);
  });
});

describe('OtpInput', () => {
  it.each(['123 456', '123-456', 'Your code is 123456'])('a pasted "%s" fills all six cells', async (pasted) => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    await inTheme(<OtpInput value="" onChange={onChange} onComplete={onComplete} />);
    const input = screen.getByLabelText('6-digit code');
    expect(input.props.maxLength).toBeUndefined(); // a native maxLength would cut the paste before the digits are read
    await fireEvent.changeText(input, pasted);
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});

describe('error hints (aria-invalid is web only)', () => {
  it('a field with an error reads it out as its hint; without one there is none', async () => {
    const { rerender } = await inTheme(<TextField label="Username" error="Username already taken" />);
    expect(screen.getByLabelText('Username').props.accessibilityHint).toBe('Username already taken');
    await rerender(
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
          <View>
            <TextField label="Username" />
            <PhoneField label="Phone number" value="" country={COUNTRIES[0]} onCountry={() => {}} error="Enter a valid mobile number" />
            <OtpInput value="" onChange={() => {}} error="That code is wrong" />
          </View>
        </SafeAreaProvider>
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Username').props.accessibilityHint).toBeUndefined();
    expect(screen.getByLabelText('Phone number').props.accessibilityHint).toBe('Enter a valid mobile number');
    expect(screen.getByLabelText('6-digit code').props.accessibilityHint).toBe('That code is wrong');
  });
});

describe('TextField', () => {
  it('draws the border on the input when there is no left slot', async () => {
    await inTheme(<TextField label="Username" />);
    expect(flat(screen.getByLabelText('Username'))).toMatchObject({ borderWidth: 1, minHeight: 52 });
  });

  it('puts a left slot inside the border, before the input', async () => {
    await inTheme(<TextField label="Phone number" left={<Text>IN +91</Text>} />);
    const input = screen.getByLabelText('Phone number');
    const row = input.parent!;
    expect(flat(input).borderWidth).toBeUndefined();
    expect(flat(row)).toMatchObject({ borderWidth: 1, minHeight: 52, flexDirection: 'row' });
    expect(row.children[0]).toBe(screen.getByText('IN +91')); // the slot comes first, inside the bordered row
  });
});

describe('MemberPlate', () => {
  it('falls back to the initials when the photo fails to load', async () => {
    await inTheme(<MemberPlate user={{ name: 'Kabir Rao', plate: 1, avatarUrl: 'file:///cache/gone.jpg' }} />);
    expect(screen.queryByText('KR', { includeHiddenElements: true })).toBeNull();
    await fireEvent(hosts('Image')[0], 'error', { nativeEvent: { error: 'file not found' } });
    expect(screen.getByText('KR', { includeHiddenElements: true })).toBeTruthy();
    expect(hosts('Image')).toHaveLength(0);
  });
});

describe('Fab', () => {
  it('busy shows the spinner in place of the icon, is disabled and says busy', async () => {
    const onPress = jest.fn();
    await inTheme(<Fab icon="check" label="Save expense" onPress={onPress} busy />);
    const fab = screen.getByRole('button', { name: 'Save expense' });
    expect(fab).toBeDisabled();
    expect(fab).toBeBusy();
    expect(spinners()).toHaveLength(1);
    expect(hosts('RNSVGSvgView')).toHaveLength(0);
    await fireEvent.press(fab);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('not busy shows the icon and presses', async () => {
    const onPress = jest.fn();
    await inTheme(<Fab icon="check" label="Save expense" onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Save expense' })).not.toBeBusy();
    expect(spinners()).toHaveLength(0);
    expect(hosts('RNSVGSvgView')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
