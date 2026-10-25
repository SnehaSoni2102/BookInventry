import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { Empty, ErrorBox } from '../src/components/ui';
import { ApiError } from '@bookstall/api-client';

const wrap = async (ui: React.ReactElement) => render(<PaperProvider>{ui}</PaperProvider>);

describe('ui helpers', () => {
  it('shows an empty state with a hint', async () => {
    await wrap(<Empty title="Nothing here" hint="Try later" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('Try later')).toBeTruthy();
  });
  it('maps API error codes to friendly text', async () => {
    await wrap(<ErrorBox error={new ApiError('COPY_NOT_AVAILABLE', 'x', 409, { codes: ['BK1'] })} />);
    expect(screen.getByText("This book was already sold or isn't available (BK1)")).toBeTruthy();
  });
});
