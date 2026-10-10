import { normalizePhone } from './marketing.constants';

describe('normalizePhone', () => {
  it('maps every common way of writing a Nigerian number to one form', () => {
    expect(normalizePhone('08031234567')).toBe('2348031234567');
    expect(normalizePhone('+234 803 123 4567')).toBe('2348031234567');
    expect(normalizePhone('234-803-123-4567')).toBe('2348031234567');
    expect(normalizePhone('(0803) 123 4567')).toBe('2348031234567');
    expect(normalizePhone('8031234567')).toBe('2348031234567');
  });

  it('leaves other numbers as digits only', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958');
    expect(normalizePhone('12345')).toBe('12345');
  });
});
