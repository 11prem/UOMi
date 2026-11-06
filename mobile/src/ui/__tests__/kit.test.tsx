import { StyleSheet, Text, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { OtpInput } from '../OtpInput';
import { Stamp } from '../Stamp';
import { TextField } from '../TextField';

// Screens always put kit parts inside a host view; RNTL's label queries miss a TextInput whose only host ancestor is the field.
const inTheme = (ui: React.ReactElement) =>
  render(
    <ThemeProvider>
      <View>{ui}</View>
    </ThemeProvider>,
  );
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) ?? {};

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
