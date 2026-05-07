import { expect, type Page, test } from '@playwright/test';
import { replaceMonacoEditorValue } from '../fixtures/editor.ts';
import { setFirestoreEmulatorDocument } from '../fixtures/firestore-rest.ts';
import {
  addLocalEmulatorAccount,
  EMULATOR_CONNECTION_ID,
  openFdql,
  openLiveApp,
  uniqueSmokeId,
} from '../fixtures/live-app.ts';

test('FDQL runs bounded read workflows and clears invalid output', async () => {
  const live = await openLiveApp();
  try {
    const page = live.page;
    const data = await seedFdqlReadData();
    await addLocalEmulatorAccount(page);
    await openFdql(page);

    await test.step('bounded read shows only returned fields', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("orders", [])

from $orders as o
fs order by o.total desc
fs limit 1

return fs.id(o) as id`,
      );

      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader', { name: 'id' })).toBeVisible();
      await expect(table.getByRole('columnheader', { name: 'status' })).toHaveCount(0);
      await expect(table.getByRole('columnheader', { name: 'total' })).toHaveCount(0);
      await expect(table.locator('tbody tr')).toHaveCount(1);
      await expect(table.getByRole('cell', { name: 'ord_1123' })).toBeVisible();
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();
      await expect(page.getByText('1 scanned')).toBeVisible();
    });

    await test.step('field projection shows exact result cells and result views', async () => {
      await runFdql(
        page,
        `set fdql.readBudget = 5000

alias $versions = fs.collection("public-versions", ["version"])

from $versions as v
fs where fs.id(v) = "version"

return fs.id(v) as id, v.version`,
      );

      await expectFdqlTable(page, ['id', 'version'], [['version', '3166']]);
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader', { name: 'platform' })).toHaveCount(0);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();
      await expect(page.getByText('1 scanned')).toBeVisible();

      await page.getByRole('tab', { name: 'Tree' }).click();
      await expect(page.getByRole('tree').filter({ hasText: 'row_1' })).toBeVisible();
      await page.getByRole('tab', { name: 'JSON' }).click();
      await expect(page.getByLabel('FDQL JSON results')).toHaveValue(/"version": 3166/);
      await page.getByRole('tab', { name: 'Table' }).click();
    });

    await test.step('read budget stops after partial rows', async () => {
      await runFdql(
        page,
        `set fdql.readBudget = 1

alias $orders = fs.collection("orders", [])

from $orders as o
fs order by o.total desc
fs limit 3

return fs.id(o) as id`,
      );

      await expectFdqlTable(page, ['id'], [['ord_1123']]);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();
      await expect(page.getByRole('tab', { name: /Results budget/ })).toBeVisible();
    });

    await test.step('lookup one attaches related documents', async () => {
      await runFdql(
        page,
        `alias $drivers = fs.collection("${data.drivers}", ["firstName", "teamId"])
alias $teams = fs.collection("${data.teams}", ["name"])

from $drivers as d
fs where fs.id(d) = "drv_1"

then lookup one $teams as team
  fs where fs.id(team) = d.teamId

return fs.id(d) as id, d.firstName, team.name as teamName`,
      );

      await expectFdqlTable(page, ['id', 'firstName', 'teamName'], [['drv_1', 'Vini', 'Orange']]);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('2 reads')).toBeVisible();
      await expect(page.getByText('2 scanned')).toBeVisible();
    });

    await test.step('unwind entries expands map rows', async () => {
      await runFdql(
        page,
        `alias $drivers = fs.collection("${data.drivers}", ["metadata"])

from $drivers as d
fs where fs.id(d) = "drv_1"

then unwind entries(d.metadata) as entry
then sort by entry.key asc

return entry.key, entry.value, mapGet(d.metadata, entry.key) as dynamicValue`,
      );

      await expectFdqlTable(
        page,
        ['key', 'value', 'dynamicValue'],
        [
          ['region', 'apac', 'apac'],
          ['tier', 'gold', 'gold'],
        ],
      );
      await expect(page.getByText('2 rows')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();
    });

    await test.step('aggregate groups bounded local rows', async () => {
      await runFdql(
        page,
        `alias $rounds = fs.collection("${data.rounds}", ["driverId", "score"])

from $rounds as r
fs limit 10

then aggregate
  by r.driverId as driverId
  count() as total,
  sum(r.score) as score

then sort by driverId asc

return driverId, total, score`,
      );

      await expectFdqlTable(
        page,
        ['driverId', 'total', 'score'],
        [
          ['drv_1', '2', '15'],
          ['drv_2', '1', '7'],
        ],
      );
      await expect(page.getByText('2 rows')).toBeVisible();
      await expect(page.getByText('3 reads')).toBeVisible();
    });

    await test.step('union all streams branches in order', async () => {
      await runFdql(
        page,
        `alias $drivers = fs.collection("${data.drivers}", [])
alias $teams = fs.collection("${data.teams}", [])

from $drivers as d
fs where fs.id(d) = "drv_1"
return fs.id(d) as id, "driver" as kind

union all

from $teams as t
fs where fs.id(t) = "team_1"
return fs.id(t) as id, "team" as kind`,
      );

      await expectFdqlTable(
        page,
        ['id', 'kind'],
        [
          ['drv_1', 'driver'],
          ['team_1', 'team'],
        ],
      );
      await expect(page.getByText('2 rows')).toBeVisible();
      await expect(page.getByText('2 reads')).toBeVisible();
    });

    await test.step('collection group reads nested collections', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collectionGroup("orders", ["status"])

from $orders as o
fs where o.status = "nested"
fs limit 1

return fs.path(o) as path, o.status`,
      );

      await expectFdqlTable(
        page,
        ['path', 'status'],
        [[`${data.parent}/parent_1/orders/${data.nestedOrderId}`, 'nested']],
      );
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();
    });

    await test.step('nested map and array workflow uses persistent lookup cache', async () => {
      const nestedLookupQuery = `set fdql.cache = persistent

alias $events = fs.collection("${data.events}", ["name", "slug", "schedule", "entriesById"])
alias $drivers = fs.collection("${data.eventDrivers}", ["firstName", "steamId"])

from $events as event
fs order by event.schedule.startsAt desc
fs limit 20
then unwind entries(event.entriesById) as entry
then unwind entry.value.drivers as eventDriver
then take 4
then lookup one $drivers as driver cache persistent
  fs where fs.id(driver) = eventDriver.steamId
return eventDriver.steamId, driver.firstName, event.slug, event.name, event.schedule.startsAt`;

      await runFdql(page, nestedLookupQuery);

      await expectFdqlTable(
        page,
        ['steamId', 'firstName', 'slug', 'name', 'startsAt'],
        [
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ben', 'Ben', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['', '', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
        ],
      );
      await expect(page.getByText('4 rows')).toBeVisible();
      await expect(page.getByText('3 reads')).toBeVisible();
      await expect(page.getByText('3 scanned')).toBeVisible();
      await expect(page.getByText('1 cache hit')).toBeVisible();
      await expect(page.getByText('2 cache misses')).toBeVisible();
      await expect(page.getByText('2 cache writes')).toBeVisible();

      await runFdql(page, nestedLookupQuery);

      await expectFdqlTable(
        page,
        ['steamId', 'firstName', 'slug', 'name', 'startsAt'],
        [
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ben', 'Ben', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['', '', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
        ],
      );
      await expect(page.getByText('3 cache hits')).toBeVisible();
      await expect(page.getByText('1 reads')).toBeVisible();

      await runFdql(page, `clear cache provider fs project "${EMULATOR_CONNECTION_ID}"`);

      await expect(page.getByText('Cache cleared')).toBeVisible();
      await expect(page.getByText(/Cleared [1-9]\d* cache entries\./)).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);

      await runFdql(page, nestedLookupQuery);

      await expectFdqlTable(
        page,
        ['steamId', 'firstName', 'slug', 'name', 'startsAt'],
        [
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ben', 'Ben', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['', '', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
        ],
      );
      await expect(page.getByText('4 rows')).toBeVisible();
      await expect(page.getByText('3 reads')).toBeVisible();
      await expect(page.getByText('1 cache hit')).toBeVisible();
      await expect(page.getByText('2 cache misses')).toBeVisible();
      await expect(page.getByText('2 cache writes')).toBeVisible();

      await page.getByRole('tab', { name: 'Tree' }).click();
      await expect(page.getByRole('tree').filter({ hasText: 'row_1' })).toBeVisible();
      await page.getByRole('tab', { name: 'JSON' }).click();
      await expect(page.getByLabel('FDQL JSON results')).toHaveValue(/"steamId": "steam_ada"/);
      await page.getByRole('tab', { name: 'Table' }).click();
    });

    await test.step('required lookup one drops missing correlated rows', async () => {
      await runFdql(
        page,
        `set fdql.cache = off

alias $events = fs.collection("${data.events}", ["name", "slug", "schedule", "entriesById"])
alias $drivers = fs.collection("${data.eventDrivers}", ["firstName", "steamId"])

from $events as event
fs order by event.schedule.startsAt desc
fs limit 20
then unwind entries(event.entriesById) as entry
then unwind entry.value.drivers as eventDriver
then take 4
then lookup required one $drivers as driver
  fs where fs.id(driver) = eventDriver.steamId
return eventDriver.steamId, driver.firstName, event.slug, event.name, event.schedule.startsAt`,
      );

      await expectFdqlTable(
        page,
        ['steamId', 'firstName', 'slug', 'name', 'startsAt'],
        [
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ada', 'Ada', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
          ['steam_ben', 'Ben', 'event_24h', '24H Mount', '2026-05-05T10:27:00.000Z'],
        ],
      );
      await expect(page.getByText('3 rows')).toBeVisible();
    });

    await test.step('duplicate fs limit is an issue and clears stale rows', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("orders")

from $orders as o
fs limit 1
fs limit 1

return fs.id(o) as id`,
      );

      await page.getByRole('tab', { name: /Issues/ }).click();
      await expect(page.getByText('FDQL_DUPLICATE_STAGE')).toBeVisible();
      await page.getByRole('tab', { name: /Results/ }).click();
      await expect(page.getByText('No rows yet')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    });
  } finally {
    await live.close();
  }
});

async function seedFdqlReadData(): Promise<{
  readonly drivers: string;
  readonly eventDrivers: string;
  readonly events: string;
  readonly nestedOrderId: string;
  readonly parent: string;
  readonly rounds: string;
  readonly teams: string;
}> {
  const suffix = uniqueSmokeId('fdql').replace(/-/g, '_');
  const drivers = `fdqlDrivers_${suffix}`;
  const eventDrivers = `fdqlEventDrivers_${suffix}`;
  const events = `fdqlEvents_${suffix}`;
  const teams = `fdqlTeams_${suffix}`;
  const rounds = `fdqlRounds_${suffix}`;
  const parent = `fdqlParents_${suffix}`;
  const nestedOrderId = `nested_${suffix}`;

  await Promise.all([
    setFirestoreEmulatorDocument(`${drivers}/drv_1`, {
      firstName: 'Vini',
      metadata: { region: 'apac', tier: 'gold' },
      teamId: 'team_1',
    }),
    setFirestoreEmulatorDocument(`${drivers}/drv_2`, {
      firstName: 'Alex',
      metadata: { region: 'emea', tier: 'silver' },
      teamId: 'team_2',
    }),
    setFirestoreEmulatorDocument(`${eventDrivers}/steam_ada`, {
      firstName: 'Ada',
      steamId: 'steam_ada',
    }),
    setFirestoreEmulatorDocument(`${eventDrivers}/steam_ben`, {
      firstName: 'Ben',
      steamId: 'steam_ben',
    }),
    setFirestoreEmulatorDocument(`${events}/event_24h`, {
      entriesById: {
        entry_1: {
          drivers: [
            { steamId: 'steam_ada' },
            { steamId: 'steam_ada' },
            { steamId: 'steam_ben' },
            {},
          ],
        },
      },
      name: '24H Mount',
      schedule: { startsAt: '2026-05-05T10:27:00.000Z' },
      slug: 'event_24h',
    }),
    setFirestoreEmulatorDocument(`${teams}/team_1`, { name: 'Orange' }),
    setFirestoreEmulatorDocument(`${teams}/team_2`, { name: 'Blue' }),
    setFirestoreEmulatorDocument(`${rounds}/round_1`, { driverId: 'drv_1', score: 10 }),
    setFirestoreEmulatorDocument(`${rounds}/round_2`, { driverId: 'drv_1', score: 5 }),
    setFirestoreEmulatorDocument(`${rounds}/round_3`, { driverId: 'drv_2', score: 7 }),
    setFirestoreEmulatorDocument(`${parent}/parent_1/orders/${nestedOrderId}`, {
      status: 'nested',
    }),
  ]);

  return { drivers, eventDrivers, events, nestedOrderId, parent, rounds, teams };
}

async function runFdql(page: Page, source: string): Promise<void> {
  await replaceMonacoEditorValue(page, page.locator('body'), source);
  await page.getByRole('button', { name: 'Run' }).click();
}

async function expectFdqlTable(
  page: Page,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): Promise<void> {
  const table = page.getByRole('table');
  await expect(table.locator('thead th')).toHaveText(headers);
  await expect(table.locator('tbody tr')).toHaveCount(rows.length);
  await Promise.all(
    rows.map((row, index) =>
      expect(table.locator('tbody tr').nth(index).locator('td')).toHaveText(row)
    ),
  );
}
