export type ProviderScenario = 'success' | 'timeout' | 'provider_error' | 'network_failure';

export async function mockCharge(
  idempotencyKey: string,
  scenario: ProviderScenario = 'success',
): Promise<{ success: boolean; reference?: string; status?: string; message?: string }> {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  switch (scenario) {
    case 'success':
      await delay(80);
      return { success: true, reference: `mock_${idempotencyKey.slice(0, 12)}`, status: 'success' };
    case 'timeout':
      await delay(150);
      throw Object.assign(new Error('Provider request timed out'), { code: 'ETIMEDOUT' });
    case 'provider_error':
      await delay(60);
      return { success: false, status: 'declined', message: 'Card declined by issuer' };
    case 'network_failure':
      await delay(40);
      throw Object.assign(new Error('Network unreachable'), { code: 'ECONNREFUSED' });
  }
}
