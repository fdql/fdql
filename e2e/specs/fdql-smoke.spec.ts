import { expect, type Page, test } from '@playwright/test';
import {
  monacoModelMarkers,
  replaceMonacoEditorValue,
  typeMonacoEditorValue,
} from '../fixtures/editor.ts';
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

    await test.step('editor suggests nested masked fields', async () => {
      await typeMonacoEditorValue(
        page,
        page.locator('body'),
        `alias $events = fs.collection("${data.events}", ["schedule.startsAt"])

from $events as event
return event.schedule.`,
      );
      await page.keyboard.press('Control+Space');

      await expect(page.locator('.suggest-widget')).toContainText('startsAt');
    });

    await test.step('field mask warnings do not block execution', async () => {
      await replaceMonacoEditorValue(
        page,
        page.locator('body'),
        `alias $orders = fs.collection("orders", ["status"])

from $orders as o
fs limit 1
then filter o.total is missing

return o.status`,
      );

      await expect.poll(async () => monacoModelMarkers(page)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'FDQL_FIELD_NOT_IN_MASK' }),
        ]),
      );
      await page.getByRole('button', { name: 'Run' }).click();

      await expect(page.getByRole('tab', { name: /Results completed/ })).toBeVisible();
      await expect(page.getByText('1 rows')).toBeVisible();
    });

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

    await test.step('native Firestore predicates support common read operators', async () => {
      await runFdql(
        page,
        `alias $drivers = fs.collection("${data.drivers}", ["firstName", "tags", "retiredAt"])

from $drivers as d
fs where d.firstName not in ["Alex"]
fs limit 1
return fs.id(d) as id, "notIn" as check

union all

from $drivers as d
fs where d.retiredAt is null
fs limit 1
return fs.id(d) as id, "isNull" as check

union all

from $drivers as d
fs where d.retiredAt is not null
fs limit 1
return fs.id(d) as id, "isNotNull" as check

union all

from $drivers as d
fs where fs.arrayContainsAny(d.tags, ["admin", "staff"])
fs limit 1
return fs.id(d) as id, "arrayAny" as check`,
      );

      await expectFdqlTable(
        page,
        ['id', 'check'],
        [
          ['drv_1', 'notIn'],
          ['drv_1', 'isNull'],
          ['drv_2', 'isNotNull'],
          ['drv_1', 'arrayAny'],
        ],
      );
      await expect(page.getByText('4 rows')).toBeVisible();
    });

    await test.step('local expressions support case, math, exists, and missing', async () => {
      await runFdql(
        page,
        `alias $drivers = fs.collection("${data.drivers}", ["firstName", "score", "retiredAt", "metadata"])

from $drivers as d
fs where fs.id(d) = "drv_1"

then filter exists(d.retiredAt) and missing(d.archivedAt)

return
  case when d.score + 1 > 10 then "podium" else "field" end as bucket,
  d.score * 2 as doubled,
  -d.score + 15 as adjusted,
  d.unknown is missing as unknownMissing`,
      );

      await expectFdqlTable(
        page,
        ['bucket', 'doubled', 'adjusted', 'unknownMissing'],
        [['podium', '24', '3', 'true']],
      );
      await expect(page.getByText('1 rows')).toBeVisible();
    });

    await test.step('invalid native query limits show issues before reads', async () => {
      await runFdql(
        page,
        `alias $drivers = fs.collection("${data.drivers}", ["firstName", "score"])

from $drivers as d
fs where d.score >= 1
fs order by d.firstName asc
fs limit 1

return fs.id(d) as id, d.score`,
      );

      await page.getByRole('tab', { name: /Issues/ }).click();
      await expect(page.getByText('FDQL_UNSUPPORTED_FS_ORDER_BY')).toBeVisible();
      await page.getByRole('tab', { name: /Results/ }).click();
      await expect(page.getByText('No rows yet')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);

      await runFdql(
        page,
        `alias $drivers = fs.collection("${data.drivers}", ["firstName", "score"])

from $drivers as d
fs where d.score >= 1
fs order by d.score desc
fs limit 1

return fs.id(d) as id, d.score`,
      );

      await expectFdqlTable(page, ['id', 'score'], [['drv_1', '12']]);
      await expect(page.getByText('1 reads')).toBeVisible();
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
  yield count() as total,
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

    await test.step('provider aggregate counts documents in one collection', async () => {
      await runFdql(
        page,
        `alias $rounds = fs.collection("${data.rounds}", [])

from fs.aggregate $rounds
  yield fs.count() as total

return total`,
      );

      await expectFdqlTable(page, ['total'], [['3']]);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('0 reads')).toBeVisible();
      await expect(page.getByText('1 aggregate')).toBeVisible();
    });

    await test.step('provider aggregate reads a collection without where', async () => {
      await runFdql(
        page,
        `alias $rounds = fs.collection("${data.rounds}", ["score"])

from fs.aggregate $rounds as r
  yield fs.count() as total,
        fs.sum(r.score) as score

return total, score`,
      );

      await expectFdqlTable(page, ['total', 'score'], [['3', '22']]);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('0 reads')).toBeVisible();
      await expect(page.getByText('1 aggregate')).toBeVisible();
    });

    await test.step('provider aggregate reads static subcollections', async () => {
      await runFdql(
        page,
        `alias $orders = fs.subcollection("${data.parent}/parent_1", "orders", ["status"])

from fs.aggregate $orders
  yield fs.count() as total

return total`,
      );

      await expectFdqlTable(page, ['total'], [['1']]);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('0 reads')).toBeVisible();
      await expect(page.getByText('1 aggregate')).toBeVisible();
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

    await test.step('subcollection reads support static, dynamic, and template sources', async () => {
      await runFdql(
        page,
        `alias $orders = fs.subcollection("${data.parent}/parent_1", "orders", ["status"])

from $orders as o
fs where fs.id(o) = "${data.nestedOrderId}"

return fs.id(o) as id, o.status`,
      );

      await expectFdqlTable(page, ['id', 'status'], [[data.nestedOrderId, 'nested']]);

      await runFdql(
        page,
        `alias $parents = fs.collection("${data.parent}", [])
alias $orders = fs.subcollection("orders", ["status"])

from $parents as p
fs where fs.id(p) = "parent_1"
then lookup many fs.subcollection(p, "orders", ["status"]) as inlineOrders
then lookup many $orders of p as templateOrders

return fs.id(p) as id, inlineOrders, templateOrders`,
      );

      await expectFdqlTable(page, ['id', 'inlineOrders', 'templateOrders'], [
        ['parent_1', '[{"status":"nested"}]', '[{"status":"nested"}]'],
      ]);
      await expect(page.getByText('1 rows')).toBeVisible();
      await expect(page.getByText('3 reads')).toBeVisible();
    });

    await test.step('return wildcard keeps empty rows and aggregate maps', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("${data.parent}", [])
alias $skiers = fs.subcollection("orders", [])

from $orders as order
fs where fs.id(order) = "parent_1"

then fs.aggregate $skiers of order
  yield { fs.count() as total } as stats

return *`,
      );

      await expectFdqlTable(page, ['order', 'stats'], [['{}', '{"total":1}']]);
      await page.getByRole('tab', { name: 'Tree' }).click();
      await expect(page.getByRole('tree').filter({ hasText: 'stats' })).toBeVisible();
      await page.getByRole('tab', { name: 'JSON' }).click();
      await expect(page.getByLabel('FDQL JSON results')).toHaveValue(/"stats": \{\s+"total": 1/);
      await page.getByRole('tab', { name: 'Table' }).click();
    });

    await test.step('return spread projects aggregate maps', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("${data.parent}", [])
alias $skiers = fs.subcollection("orders", [])

from $orders as order
fs where fs.id(order) = "parent_1"

then fs.aggregate $skiers of order
  yield { fs.count() as total } as stats

return fs.id(order) as orderId, ...stats`,
      );

      await expectFdqlTable(page, ['orderId', 'total'], [['parent_1', '1']]);
    });

    await test.step('missing return is an issue and clears stale rows', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("${data.parent}", [])
alias $skiers = fs.subcollection("orders", [])

from $orders as order
fs where fs.id(order) = "parent_1"

then fs.aggregate $skiers of order
  yield fs.count() as total`,
      );

      await page.getByRole('tab', { name: /Issues/ }).click();
      await expect(page.getByText('FDQL_MISSING_RETURN')).toBeVisible();
      await page.getByRole('tab', { name: /Results/ }).click();
      await expect(page.getByText('No rows yet')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    });

    await test.step('unknown return binding is an issue and clears stale rows', async () => {
      await runFdql(
        page,
        `alias $orders = fs.collection("${data.parent}", [])
alias $skiers = fs.subcollection("orders", [])

from $orders as order
fs where fs.id(order) = "parent_1"

then fs.aggregate $skiers of order
  yield fs.count() as total

return missingTotal`,
      );

      await page.getByRole('tab', { name: /Issues/ }).click();
      await expect(page.getByText('FDQL_UNKNOWN_ROW_BINDING')).toBeVisible();
      await page.getByRole('tab', { name: /Results/ }).click();
      await expect(page.getByText('No rows yet')).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    });

    await test.step('invalid subcollection lookup syntax clears stale rows', async () => {
      await runFdql(
        page,
        `alias $parents = fs.collection("${data.parent}", [])
alias $orders = fs.subcollection("orders", ["status"])

from $parents as p
fs limit 1
then lookup many $orders as order
return order.status`,
      );

      await page.getByRole('tab', { name: /Issues/ }).click();
      await expect(page.getByText('FDQL_INVALID_LOOKUP_PARENT')).toBeVisible();
      await page.getByRole('tab', { name: /Results/ }).click();
      await expect(page.getByText('No rows yet')).toBeVisible();
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

    await test.step('provider aggregate returns exact cells and uses run cache', async () => {
      await runFdql(
        page,
        `set fdql.cache = run

alias $events = fs.collection("${data.events}", ["name", "slug", "schedule", "entriesById"])
alias $rounds = fs.collection("${data.eventRounds}", ["driverId", "points", "createdAt"])

from $events as event
fs order by event.schedule.startsAt desc
fs limit 20
then unwind entries(event.entriesById) as entry
then unwind entry.value.drivers as eventDriver
then take 3
then fs.aggregate $rounds as round cache run
  fs where round.driverId = eventDriver.steamId
  yield fs.count() as total, fs.sum(round.points) as points, fs.avg(round.points) as avgPoints, fs.min(round.createdAt) as firstRoundAt, fs.max(round.createdAt) as lastRoundAt
return eventDriver.steamId, total, points, avgPoints, firstRoundAt, lastRoundAt`,
      );

      await expectFdqlTable(
        page,
        ['steamId', 'total', 'points', 'avgPoints', 'firstRoundAt', 'lastRoundAt'],
        [
          [
            'steam_ada',
            '2',
            '14',
            '7',
            '2026-01-05T10:00:00.000Z',
            '2026-02-05T10:00:00.000Z',
          ],
          [
            'steam_ada',
            '2',
            '14',
            '7',
            '2026-01-05T10:00:00.000Z',
            '2026-02-05T10:00:00.000Z',
          ],
          [
            'steam_ben',
            '1',
            '7',
            '7',
            '2026-03-05T10:00:00.000Z',
            '2026-03-05T10:00:00.000Z',
          ],
        ],
      );
      await expect(page.getByText('3 rows')).toBeVisible();
      await expect(page.getByText('5 reads')).toBeVisible();
      await expect(page.getByText('5 scanned')).toBeVisible();
      await expect(page.getByText('2 aggregates')).toBeVisible();
      await expect(page.getByText('1 cache hit')).toBeVisible();
      await expect(page.getByText('2 cache misses')).toBeVisible();
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
      const issueLocation = page.getByRole('button', { name: /Line 5/ });
      await expect(issueLocation).toBeVisible();
      await issueLocation.click();
      await expect(page.locator('.monaco-editor.focused')).toBeVisible();
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
  readonly eventRounds: string;
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
  const eventRounds = `fdqlEventRounds_${suffix}`;
  const events = `fdqlEvents_${suffix}`;
  const teams = `fdqlTeams_${suffix}`;
  const rounds = `fdqlRounds_${suffix}`;
  const parent = `fdqlParents_${suffix}`;
  const nestedOrderId = `nested_${suffix}`;

  await Promise.all([
    setFirestoreEmulatorDocument(`${drivers}/drv_1`, {
      firstName: 'Vini',
      metadata: { region: 'apac', tier: 'gold' },
      retiredAt: null,
      score: 12,
      tags: ['admin', 'staff'],
      teamId: 'team_1',
    }),
    setFirestoreEmulatorDocument(`${drivers}/drv_2`, {
      firstName: 'Alex',
      metadata: { region: 'emea', tier: 'silver' },
      retiredAt: '2026-01-01T00:00:00.000Z',
      score: 4,
      tags: ['guest'],
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
    setFirestoreEmulatorDocument(`${eventRounds}/round_ada_1`, {
      createdAt: '2026-01-05T10:00:00.000Z',
      driverId: 'steam_ada',
      points: 10,
    }),
    setFirestoreEmulatorDocument(`${eventRounds}/round_ada_2`, {
      createdAt: '2026-02-05T10:00:00.000Z',
      driverId: 'steam_ada',
      points: 4,
    }),
    setFirestoreEmulatorDocument(`${eventRounds}/round_ben_1`, {
      createdAt: '2026-03-05T10:00:00.000Z',
      driverId: 'steam_ben',
      points: 7,
    }),
    setFirestoreEmulatorDocument(`${parent}/parent_1`, { name: 'Parent 1' }),
    setFirestoreEmulatorDocument(`${parent}/parent_1/orders/${nestedOrderId}`, {
      status: 'nested',
    }),
  ]);

  return { drivers, eventDrivers, eventRounds, events, nestedOrderId, parent, rounds, teams };
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
