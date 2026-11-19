// Passengers: who is in the back, what they want from the drive, what they say, and how they judge it.
// Pure functions, so the rules can be tested. Each type bends the same fare in a different way.
export const TYPES = {
  commuter: {
    id: 'commuter', noun: 'A passenger', weight: 3, par: 1, heat: 1, look: .08,
    intro: 'Morning. The usual route, please.',
    mid: ['Traffic is better than yesterday.', 'You know this road well.'],
    bad: ['Mind the road, please.'],
    bye: ['Thanks, have a good day.'],
  },
  late: {
    id: 'late', noun: 'A passenger', weight: 2, par: .8, heat: 1, look: .02,
    intro: 'I am late for a meeting. Please hurry!',
    mid: ['Come on, come on...', 'Every minute counts.'],
    bad: ['We are never going to make it.'],
    bye: ['Just in time. Keep the change.', 'I missed it. Thanks anyway.'],
  },
  nervous: {
    id: 'nervous', noun: 'A passenger', weight: 2, par: 1.1, heat: 1, look: .55,
    intro: 'Please drive gently. I hate fast cars.',
    mid: ['Nice and smooth. Thank you.', 'I can relax a little.'],
    bad: ['Slow down, please!', 'That was too fast!'],
    bye: ['That was calm. I will ask for you again.', 'I need to sit down.'],
  },
  tourist: {
    id: 'tourist', noun: 'A passenger', weight: 2, par: 1.35, heat: 1, look: .3,
    intro: 'Slowly, please. I want to see the valley.',
    mid: ['What a view!', 'Is that the river? Lovely.'],
    bad: ['We are not in a race!'],
    bye: ['Wonderful. Best ride of the trip.', 'Beautiful valley.'],
  },
  chatty: {
    id: 'chatty', noun: 'A passenger', weight: 2, par: 1, heat: 1, look: .7,
    intro: 'Hello! Lovely weather. Is it always this busy?',
    mid: ['My sister lives out this way, you know.', 'Do you drive here all day? What a life.', 'Pretty roads in the valley.'],
    bad: ['Whoa, easy!'],
    bye: ['Lovely chat. Take care!'],
  },
  quiet: {
    id: 'quiet', noun: 'A passenger', weight: 1, par: 1, heat: 1, look: .9,
    intro: 'Not a word, please. And no horn.',
    mid: ['...'],
    bad: ['Quiet, please.'],
    bye: ['Thank you.'],
  },
  risky: {
    id: 'risky', noun: 'A passenger', weight: 1, par: .7, heat: 2, look: .4,
    intro: 'Double tip if you get me there fast. Do not mind the police.',
    mid: ['Faster! You can do better.', 'Lose them if you have to.'],
    bad: ['I said fast, not dead.'],
    bye: ['Smooth. Here is your bonus.', 'Too slow. No bonus.'],
  },
};
export const TYPE_LIST = Object.values(TYPES);

/** A type from a random number generator: stable for a given fare. */
export function pickType(rng) {
  const total = TYPE_LIST.reduce((sum, type) => sum + type.weight, 0);
  let roll = rng() * total;
  for (const type of TYPE_LIST) { roll -= type.weight; if (roll <= 0) return type; }
  return TYPE_LIST[0];
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * How this passenger rates the drive so far, from what happened on it.
 * s: ratio (time / par, already scaled by the type), crashes, fines, hardBrakes, overspeed (seconds), horns.
 * Returns stars (1-5 in halves), the tip as a share of the fare, a pay penalty and the reasons.
 */
export function judge(type, s) {
  const {ratio = 0, crashes = 0, fines = 0, hardBrakes = 0, overspeed = 0, horns = 0} = s;
  let stars = 5, tip = 0, penalty = 0;
  const notes = [];
  if (ratio > 1.5) { stars -= 1.5; penalty += .15; notes.push('late'); } else if (ratio > 1.15) { stars -= .5; notes.push('a bit slow'); }
  if (crashes) { stars -= Math.min(3, crashes * 1.5); penalty += Math.min(.6, crashes * .2); notes.push(crashes === 1 ? 'a crash' : crashes + ' crashes'); }
  if (fines) { stars -= Math.min(2, fines); notes.push(fines === 1 ? 'a fine' : fines + ' fines'); }
  switch (type.id) {
    case 'late':
      if (ratio > 1) { stars -= .5; notes.push('missed the meeting'); } else tip += .35;
      break;
    case 'nervous':
      if (hardBrakes) { stars -= Math.min(2, hardBrakes * .5); notes.push('hard braking'); }
      if (overspeed > 3) { stars -= 1; notes.push('too fast'); }
      if (!hardBrakes && overspeed <= 3 && !crashes) tip += .2;
      break;
    case 'tourist':
      if (overspeed > 5) { stars -= 1; notes.push('speeding past the view'); } else if (overspeed < 2) tip += .2;
      break;
    case 'quiet':
      if (horns) { stars -= Math.min(2, horns * .5); notes.push('the horn'); } else tip += .15;
      break;
    case 'risky':
      if (ratio <= 1 && !crashes) { tip += 1; notes.push('hot fare bonus'); }
      break;
    case 'chatty':
      if (!crashes) tip += .1;
      break;
    default: break;
  }
  stars = clamp(Math.round(stars * 2) / 2, 1, 5);
  if (!fines) {
    if (stars >= 4.5 && ratio <= 1) tip += .25; else if (stars >= 4) tip += .1;
  } else tip = 0;
  return {stars, tip: clamp(tip, 0, 1.5), penalty: Math.min(.6, penalty), notes};
}

/** What they say at a point in the drive. `bad` when the ride is going badly, else a mid-way remark. */
export function remark(type, kind, seed = 0, bad = false) {
  const pick = list => list[Math.abs(Math.floor(seed)) % list.length];
  if (kind === 'intro') return type.intro;
  if (kind === 'bye') return pick(type.bye);
  return bad ? pick(type.bad) : pick(type.mid);
}
