import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { PaymentTriggerMessage } from '@zolltool/shared';
import { Rooms } from '../src/ws';

function fakeSocket(): WebSocket {
  return { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn() } as unknown as WebSocket;
}

describe('Rooms.relayToDevice', () => {
  it('delivers only to the named target device, not the whole room', () => {
    const rooms = new Rooms();
    const register = fakeSocket();
    const carbon = fakeSocket();
    const bystander = fakeSocket();
    rooms.add('acct-1', 'register-1', register);
    rooms.add('acct-1', 'carbon-1', carbon);
    rooms.add('acct-1', 'bystander-1', bystander);

    const trigger: PaymentTriggerMessage = {
      type: 'payment.trigger',
      to: 'carbon-1',
      requestId: 'req-1',
      amount: 12.5,
      currency: 'SEK',
      reference: 'zoll-1',
    };
    rooms.relayToDevice('acct-1', 'register-1', trigger);

    expect(carbon.send).toHaveBeenCalledTimes(1);
    expect(register.send).not.toHaveBeenCalled();
    expect(bystander.send).not.toHaveBeenCalled();

    const sent = JSON.parse((carbon.send as any).mock.calls[0][0]);
    expect(sent).toEqual({ ...trigger, from: 'register-1' });
  });

  it('does not cross accounts', () => {
    const rooms = new Rooms();
    const carbonAcct1 = fakeSocket();
    const carbonAcct2 = fakeSocket(); // same deviceId, different account — must not receive
    rooms.add('acct-1', 'carbon-1', carbonAcct1);
    rooms.add('acct-2', 'carbon-1', carbonAcct2);

    rooms.relayToDevice('acct-1', 'register-1', {
      type: 'payment.trigger',
      to: 'carbon-1',
      requestId: 'req-1',
      amount: 1,
      currency: 'EUR',
      reference: 'zoll-1',
    });

    expect(carbonAcct1.send).toHaveBeenCalledTimes(1);
    expect(carbonAcct2.send).not.toHaveBeenCalled();
  });

  it('is a no-op when the target device is not connected', () => {
    const rooms = new Rooms();
    const register = fakeSocket();
    rooms.add('acct-1', 'register-1', register);

    expect(() =>
      rooms.relayToDevice('acct-1', 'register-1', {
        type: 'payment.trigger',
        to: 'carbon-nowhere',
        requestId: 'req-1',
        amount: 1,
        currency: 'EUR',
        reference: 'zoll-1',
      }),
    ).not.toThrow();
    expect(register.send).not.toHaveBeenCalled();
  });
});
