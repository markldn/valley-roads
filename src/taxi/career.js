// The taxi career: cash, rating, tiers, cars bought, goals. No DOM here, so it can be tested.
// One save in localStorage carries across worlds; a failing store never breaks the game.
import { TYPES, judge } from './passengers.js';

const SAVE_KEY = 'valley-roads-career-v1';
const START_CASH = 400, START_RATING = 3.5, START_CAR = 'hatch';
const MIN_FARE = 1000, PAR_SPEED = 12, PAR_GRACE = 25, CRASH_IMPULSE = 1200;

export const TIERS = [
  {name: 'Rookie', fares: 0, rating: 0, maxKm: 6, offers: 2, pay: 1},
  {name: 'Local', fares: 4, rating: 3.4, maxKm: 12, offers: 3, pay: 1.1},
  {name: 'Regular', fares: 12, rating: 3.8, maxKm: 24, offers: 4, pay: 1.2},
  {name: 'Pro', fares: 30, rating: 4.2, maxKm: 60, offers: 4, pay: 1.35},
  {name: 'Legend', fares: 60, rating: 4.6, maxKm: Infinity, offers: 4, pay: 1.5},
];

// Price in EUR by car key. Cars not listed cost DEFAULT_PRICE.
export const PRICES = {
  hatch: 0, mirage: 900, polo: 1800, crx: 2400, golf7: 3200, jetta: 3800, ranger: 3500, transit_l2: 4500,
  cclass: 4800, outlander: 5200, transit_l4: 5200, x90: 5600, scirocco: 6000, golf8: 6500, fortuner: 7500,
  rallye: 8000, golfr: 8800, mustang: 9000, monaro: 9000, berlinette: 9500, solstice: 9800, isf: 10500,
  delorean: 11000, p930: 12000, m3gtr: 14000, dtm: 15000, vantage77: 16000, vantage98: 18000, m6: 19000,
  polizei: 20000, citybus: 25000, f458: 38000, f296: 52000, f40: 90000, huayra: 140000,
};
export const DEFAULT_PRICE = 6000;
export const priceOf = key => PRICES[key] ?? DEFAULT_PRICE;

export const GOALS = [
  {id: 'first', text: 'Complete your first fare', reward: 100, value: s => s.fares, target: 1},
  {id: 'fares10', text: 'Complete 10 fares', reward: 250, value: s => s.fares, target: 10},
  {id: 'clean5', text: 'Five fares in a row without a crash', reward: 300, value: s => s.best, target: 5},
  {id: 'stars3', text: 'Three five-star fares', reward: 200, value: s => s.fiveStar, target: 3},
  {id: 'earn5000', text: 'Earn 5 000 EUR from fares', reward: 500, value: s => s.earned, target: 5000},
  {id: 'towns6', text: 'Visit 6 different towns', reward: 300, value: s => s.towns.length, target: 6},
  {id: 'cars3', text: 'Own 3 cars', reward: 500, value: s => s.owned.length, target: 3},
  {id: 'fares30', text: 'Complete 30 fares', reward: 800, value: s => s.fares, target: 30},
  {id: 'km100', text: 'Drive 100 km with passengers', reward: 400, value: s => Math.round(s.km), target: 100},
  {id: 'rating45', text: 'Reach a 4.5 rating', reward: 600, value: s => Math.round(s.rating * 10) / 10, target: 4.5},
  {id: 'fares75', text: 'Complete 75 fares', reward: 2500, value: s => s.fares, target: 75},
];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function memoryStore() {
  const data = new Map();
  return {getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)); }};
}

export function browserStore() {
  try {
    const store = globalThis.localStorage;
    store.getItem(SAVE_KEY);
    return store;
  } catch { return memoryStore(); }
}

const freshDay = () => ({fares: 0, earned: 0, tips: 0, bonus: 0, fuel: 0, fines: 0, repairs: 0, failed: 0});

export const rentFor = tier => 60 + tier * 20;

function fresh() {
  return {
    cash: START_CASH, rating: START_RATING, fares: 0, earned: 0, km: 0, streak: 0, best: 0, fiveStar: 0,
    owned: [START_CAR], towns: [], goals: [], tier: 0, enabled: true,
    day: 1, debt: 0, today: freshDay(),
  };
}

export function createCareer(store = browserStore()) {
  let s = fresh();
  try {
    const saved = JSON.parse(store.getItem(SAVE_KEY) || 'null');
    if (saved && typeof saved === 'object') s = {...s, ...saved, owned: [...new Set([START_CAR, ...(saved.owned || [])])]};
  } catch { /* an unreadable save starts a new career */ }
  let fare = null, lastCrash = -Infinity;
  const notices = [];
  const save = () => { try { store.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ } };

  const tierFor = stats => {
    let level = 0;
    TIERS.forEach((tier, index) => { if (stats.fares >= tier.fares && stats.rating >= tier.rating) level = index; });
    return Math.max(stats.tier ?? 0, level);
  };
  const checkProgress = () => {
    const level = tierFor(s);
    if (level > s.tier) {
      s.tier = level;
      notices.push(`Promoted to ${TIERS[level].name}: ${TIERS[level].maxKm === Infinity ? 'any distance' : 'fares up to ' + TIERS[level].maxKm + ' km'}, x${TIERS[level].pay} pay.`);
    }
    for (const goal of GOALS) {
      if (s.goals.includes(goal.id) || goal.value(s) < goal.target) continue;
      s.goals.push(goal.id);
      s.cash += goal.reward;
      s.today.bonus = (s.today.bonus || 0) + goal.reward;
      notices.push(`Goal done: ${goal.text}. +${goal.reward} EUR`);
    }
  };

  const api = {
    get state() { return s; },
    get enabled() { return s.enabled; },
    setEnabled(value) { s.enabled = Boolean(value); save(); },
    get tier() { return TIERS[s.tier]; },
    wallet: {
      get money() { return s.cash; },
      charge(amount) { s.cash = Math.max(0, s.cash - amount); save(); },
      spend(kind, amount) { return api.spend(kind, amount); },
      add(amount) { s.cash += amount; save(); },
    },
    // Fares a player of this tier is offered: close enough, and never fewer than one.
    filterOffers(offers) {
      const tier = TIERS[s.tier];
      const sorted = [...offers].sort((a, b) => a.length - b.length);
      const near = sorted.filter(offer => offer.length / 1000 <= tier.maxKm);
      // Fares under a kilometre are too easy to be worth offering when there is a real one.
      const worth = near.filter(offer => offer.length >= MIN_FARE);
      return (worth.length ? worth : near.length ? near : sorted.slice(0, 1)).slice(0, tier.offers);
    },
    beginFare() { fare = {crashes: 0, fines: 0}; },
    // A crash is one hard hit; the many frames of a single collision count once.
    noteImpact(impulse, now = 0) {
      if (!fare || impulse < CRASH_IMPULSE || now - lastCrash < 1500) return;
      lastCrash = now;
      fare.crashes++;
    },
    noteFine() { if (fare) fare.fines++; },
    // What the passenger makes of the drive so far, without ending it.
    mood(job, elapsed, stats = {}) {
      const type = TYPES[job?.type] ?? TYPES.commuter, f = fare ?? {crashes: 0, fines: 0};
      const par = ((job?.length ?? 0) / PAR_SPEED + PAR_GRACE) * type.par;
      return judge(type, {ratio: par ? elapsed / par : 0, crashes: f.crashes, fines: f.fines, ...stats});
    },
    // Works out what a finished fare pays. `elapsed` is the drop-off leg in seconds; `stats` is what the passenger noticed.
    settle(job, elapsed, world = '', stats = {}) {
      const type = TYPES[job.type] ?? TYPES.commuter;
      const {stars, tip, penalty, notes} = this.mood(job, elapsed, stats);
      fare = null;
      const par = (job.length / PAR_SPEED + PAR_GRACE) * type.par, ratio = elapsed / par;
      const crashed = notes.some(note => note.includes('crash'));
      const base = Math.round(job.reward * TIERS[s.tier].pay);
      const total = Math.max(5, Math.round(base * (1 + tip) * (1 - penalty)));
      s.cash += total;
      s.earned += total;
      s.today.fares++; s.today.earned += total; s.today.tips += Math.round(base * tip);
      s.fares++;
      s.km += job.length / 1000;
      s.rating = clamp(s.rating * .8 + stars * .2, 1, 5);
      if (stars >= 5) s.fiveStar++;
      s.streak = crashed ? 0 : s.streak + 1;
      s.best = Math.max(s.best, s.streak);
      for (const name of [job.from, job.to]) {
        const id = `${world}:${name}`;
        if (!s.towns.includes(id)) s.towns.push(id);
      }
      checkProgress();
      save();
      return {total, base, tip, penalty, stars, notes, ratio, type: type.id};
    },
    // A fare that ended badly: the passenger leaves, the rating takes the hit.
    failFare(reason = 'abandoned') {
      const arrested = reason === 'arrested';
      fare = null;
      s.rating = clamp(s.rating * .8 + (arrested ? 1 : 2) * .2, 1, 5);
      s.streak = 0;
      s.today.failed++;
      const fine = arrested ? this.spend('fines', 150) : 0;
      save();
      return {fine};
    },
    // Money out, with a label so the day's summary can say where it went. Never below zero.
    spend(kind, amount) {
      const paid = Math.min(s.cash, Math.max(0, Math.round(amount)));
      s.cash -= paid;
      if (kind in s.today) s.today[kind] += paid;
      save();
      return paid;
    },
    // The new day starts at 05:00: rent comes due, unpaid rent becomes debt, the books are closed.
    endDay() {
      const rent = rentFor(s.tier), due = rent + s.debt, paid = Math.min(s.cash, due);
      s.cash -= paid;
      s.debt = due - paid;
      const t = s.today;
      const summary = {day: s.day, ...t, rent, paid, debt: s.debt, cash: s.cash,
        net: t.earned + (t.bonus || 0) - t.fuel - t.fines - t.repairs - rent};
      s.today = freshDay();
      s.day++;
      save();
      return summary;
    },
    owns(key) { return !s.enabled || s.owned.includes(key); },
    canAfford(key) { return s.cash >= priceOf(key) && s.debt <= 0; },
    buy(key) {
      if (s.owned.includes(key) || s.cash < priceOf(key) || s.debt > 0) return false;
      s.cash -= priceOf(key);
      s.owned.push(key);
      checkProgress();
      save();
      return true;
    },
    // A breakdown repair: a base callout plus damage, and never more than the player holds.
    repairCost(damage = 0) { return Math.min(s.cash, Math.round(30 + clamp(damage, 0, 1) * 220)); },
    takeNotices() { return notices.splice(0); },
    goals() { return GOALS.map(goal => ({...goal, done: s.goals.includes(goal.id), progress: Math.min(goal.target, goal.value(s))})); },
    nextTier() { return TIERS[s.tier + 1] ?? null; },
    reset() { s = fresh(); fare = null; save(); },
    save,
  };
  return api;
}
