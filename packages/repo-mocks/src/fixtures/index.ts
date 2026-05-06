import {
  FirestoreGeoPoint,
  FirestoreReference,
  FirestoreTimestamp,
} from '@firebase-desk/data-format';
import type { AuthUser, ProjectSummary } from '@firebase-desk/repo-contracts';

export const MOCK_CONNECTION_LOAD_ERROR_PROJECT_ID = 'mock-connection-load-error';

export const PROJECTS: ReadonlyArray<ProjectSummary> = [
  {
    id: 'prod',
    name: 'Acme Prod',
    projectId: 'acme-prod',
    target: 'production',
    hasCredential: true,
    credentialEncrypted: true,
    createdAt: '2026-04-20T10:00:00.000Z',
  },
  {
    id: 'stage',
    name: 'Acme Staging',
    projectId: 'acme-stage',
    target: 'production',
    hasCredential: true,
    credentialEncrypted: true,
    createdAt: '2026-04-21T10:00:00.000Z',
  },
  {
    id: 'emu',
    name: 'Local Emulator',
    projectId: 'demo-local',
    target: 'emulator',
    emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
    hasCredential: false,
    credentialEncrypted: null,
    createdAt: '2026-04-22T10:00:00.000Z',
  },
  {
    id: MOCK_CONNECTION_LOAD_ERROR_PROJECT_ID,
    name: 'Broken Connection',
    projectId: 'demo-broken',
    target: 'emulator',
    emulator: { firestoreHost: '127.0.0.1:8080', authHost: '127.0.0.1:9099' },
    hasCredential: false,
    credentialEncrypted: null,
    createdAt: '2026-04-23T10:00:00.000Z',
  },
];

export interface FixtureDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

export interface FixtureCollection {
  readonly path: string;
  readonly docs: ReadonlyArray<FixtureDocument>;
}

export const COLLECTIONS: ReadonlyArray<FixtureCollection> = [
  {
    path: 'orders',
    docs: [
      {
        id: 'ord_1024',
        data: {
          status: 'paid',
          total: 129.4,
          customer: 'Ada Lovelace',
          updatedAt: new FirestoreTimestamp('2026-04-24T09:30:12.058Z'),
          deliveryLocation: new FirestoreGeoPoint(-36.8485, 174.7633),
          customerRef: new FirestoreReference('customers/cus_ada'),
          channel: 'web',
          lineItems: [
            { sku: 'sku_keyboard', quantity: 1, price: 89.4 },
            { sku: 'sku_shipping', quantity: 1, price: 40 },
          ],
          metadata: {
            fraudScore: 0.02,
            gift: false,
            tags: ['priority', 'vip'],
          },
        },
      },
      {
        id: 'ord_1025',
        data: {
          status: 'pending',
          total: 42,
          customer: 'Grace Hopper',
          updatedAt: new FirestoreTimestamp('2026-04-25T10:00:00.000Z'),
          channel: 'mobile',
          lineItems: [{ sku: 'sku_cable', quantity: 2, price: 21 }],
          metadata: { fraudScore: 0.12, gift: true, tags: ['mobile'] },
        },
      },
      {
        id: 'ord_1026',
        data: {
          status: 'refunded',
          total: 88.5,
          customer: 'Katherine Johnson',
          updatedAt: new FirestoreTimestamp('2026-04-25T13:15:00.000Z'),
          channel: 'support',
        },
      },
      {
        id: 'ord_1027',
        data: {
          status: 'paid',
          total: 260,
          customer: 'Margaret Hamilton',
          updatedAt: new FirestoreTimestamp('2026-04-26T08:45:10.000Z'),
          channel: 'web',
        },
      },
      ...generatedOrders(1028, 96),
    ],
  },
  {
    path: 'customers',
    docs: [
      {
        id: 'cus_ada',
        data: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          plan: 'enterprise',
          lastSeenAt: new FirestoreTimestamp('2026-04-26T09:05:00.000Z'),
        },
      },
      {
        id: 'cus_grace',
        data: {
          name: 'Grace Hopper',
          email: 'grace@example.com',
          plan: 'team',
          lastSeenAt: new FirestoreTimestamp('2026-04-24T21:30:00.000Z'),
        },
      },
      {
        id: 'cus_katherine',
        data: {
          name: 'Katherine Johnson',
          email: 'katherine@example.com',
          plan: 'free',
          lastSeenAt: new FirestoreTimestamp('2026-04-23T11:12:00.000Z'),
        },
      },
      ...generatedCustomers(4, 72),
    ],
  },
  {
    path: 'featureFlags',
    docs: [
      { id: 'checkout-redesign', data: { enabled: true, rollout: 0.35, owner: 'growth' } },
      { id: 'support-ai', data: { enabled: false, rollout: 0, owner: 'support' } },
      { id: 'billing-v2', data: { enabled: true, rollout: 1, owner: 'platform' } },
    ],
  },
  {
    path: 'public-versions',
    docs: [
      { id: 'version', data: { platform: 'web', version: 3166 } },
      { id: 'desktop', data: { platform: 'desktop', version: 412 } },
    ],
  },
  {
    path: 'auditLogs',
    docs: [],
  },
  {
    path: 'orders/ord_1024/events',
    docs: [
      {
        id: 'evt_created',
        data: {
          type: 'created',
          actor: 'system',
          at: new FirestoreTimestamp('2026-04-24T09:20:00.000Z'),
        },
      },
      {
        id: 'evt_paid',
        data: {
          type: 'paid',
          actor: 'stripe',
          at: new FirestoreTimestamp('2026-04-24T09:30:12.058Z'),
        },
      },
    ],
  },
  {
    path: 'orders/ord_1024/events/evt_paid/auditEntries',
    docs: [
      {
        id: 'audit_001',
        data: {
          message: 'Payment webhook verified',
          at: new FirestoreTimestamp('2026-04-24T09:30:13.000Z'),
          payload: { provider: 'stripe', liveMode: false },
        },
      },
    ],
  },
  {
    path: 'customers/cus_ada/sessions',
    docs: [
      { id: 'ses_001', data: { device: 'desktop', country: 'NZ', active: false } },
      { id: 'ses_002', data: { device: 'tablet', country: 'US', active: true } },
    ],
  },
];

export const AUTH_USERS = [
  {
    uid: 'u_ada',
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    provider: 'password',
    disabled: false,
    customClaims: {
      role: 'admin',
      tier: 'enterprise',
      permissions: ['read', 'write', 'billing'],
      org: { id: 'acme', region: 'apac' },
    },
  },
  {
    uid: 'u_grace',
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
    provider: 'google.com',
    disabled: false,
    customClaims: { role: 'editor', permissions: ['read', 'write'], teams: ['support'] },
  },
  {
    uid: 'u_katherine',
    email: 'katherine@example.com',
    displayName: 'Katherine Johnson',
    provider: 'password',
    disabled: false,
    customClaims: { role: 'viewer', permissions: ['read'], experimental: false },
  },
  {
    uid: 'u_margaret',
    email: 'margaret@example.com',
    displayName: 'Margaret Hamilton',
    provider: 'github.com',
    disabled: false,
    customClaims: { role: 'admin', beta: true, permissions: ['read', 'write', 'admin'] },
  },
  {
    uid: 'u_barbara',
    email: 'barbara@example.com',
    displayName: 'Barbara Liskov',
    provider: 'password',
    disabled: true,
    customClaims: { role: 'viewer', permissions: ['read'], disabledReason: 'manual' },
  },
  {
    uid: 'u_radya',
    email: 'radya@example.com',
    displayName: 'Radya Perlman',
    provider: 'google.com',
    disabled: false,
    customClaims: { role: 'support', permissions: ['read', 'impersonate'], queue: 'tier-1' },
  },
  ...generatedAuthUsers(1, 64),
] as const satisfies ReadonlyArray<AuthUser>;

function generatedOrders(startId: number, count: number): ReadonlyArray<FixtureDocument> {
  const statuses = ['paid', 'pending', 'refunded', 'paid'] as const;
  const channels = ['web', 'mobile', 'support'] as const;
  const regions = ['apac', 'amer', 'emea'] as const;
  return Array.from({ length: count }, (_, index) => {
    const orderNumber = startId + index;
    const day = String((index % 26) + 1).padStart(2, '0');
    const hour = String(index % 24).padStart(2, '0');
    const minute = String((index * 7) % 60).padStart(2, '0');
    return {
      id: `ord_${orderNumber}`,
      data: {
        status: statuses[index % statuses.length],
        total: Number((48 + index * 6.75).toFixed(2)),
        customer: `Virtual Customer ${String(index + 1).padStart(3, '0')}`,
        updatedAt: new FirestoreTimestamp(`2026-04-${day}T${hour}:${minute}:00.000Z`),
        channel: channels[index % channels.length],
        region: regions[index % regions.length],
        priority: index % 7 === 0,
      },
    };
  });
}

function generatedCustomers(startId: number, count: number): ReadonlyArray<FixtureDocument> {
  const plans = ['free', 'team', 'enterprise'] as const;
  return Array.from({ length: count }, (_, index) => {
    const customerNumber = startId + index;
    const day = String((index % 26) + 1).padStart(2, '0');
    const hour = String((index * 3) % 24).padStart(2, '0');
    return {
      id: `cus_virtual_${String(customerNumber).padStart(3, '0')}`,
      data: {
        name: `Virtual Customer ${String(customerNumber).padStart(3, '0')}`,
        email: `virtual.customer${String(customerNumber).padStart(3, '0')}@example.com`,
        plan: plans[index % plans.length],
        lastSeenAt: new FirestoreTimestamp(`2026-04-${day}T${hour}:15:00.000Z`),
      },
    };
  });
}

function generatedAuthUsers(startId: number, count: number): ReadonlyArray<AuthUser> {
  const providers = ['password', 'google.com', 'github.com'] as const;
  return Array.from({ length: count }, (_, index) => {
    const userNumber = startId + index;
    const padded = String(userNumber).padStart(3, '0');
    return {
      uid: `u_virtual_${padded}`,
      email: `virtual.user${padded}@example.com`,
      displayName: `Virtual User ${padded}`,
      provider: providers[index % providers.length]!,
      disabled: index % 11 === 0,
      customClaims: {
        role: index % 5 === 0 ? 'editor' : 'viewer',
        tier: index % 3 === 0 ? 'team' : 'free',
        permissions: index % 5 === 0 ? ['read', 'write'] : ['read'],
        cohorts: [`cohort-${index % 4}`],
      },
    };
  });
}

export * from './builders.ts';
