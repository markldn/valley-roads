import { TIERS, priceOf } from './career.js';

// The career panel on the menu, the locked-car labels in the vehicle selector and a HUD line.
const money = value => Math.round(value).toLocaleString('en').replace(/,/g, ' ') + ' €';

export function createCareerUi({career, byId, cars, onChange}) {
  const style = document.createElement('style');
  style.textContent = `#career-panel{margin:16px 0 0;max-width:420px;display:grid;gap:8px;text-align:left;background:none;border:0;padding:0}
#career-panel .stats{font-size:20px;font-weight:650;color:#f6c744;text-shadow:0 2px 10px #000a}
#career-panel details>summary{cursor:pointer;opacity:.75;width:fit-content;font-size:14px;color:#e9edda}
#career-panel details[open]{background:#101b18ed;border:1px solid #ffffff28;border-radius:13px;padding:12px 14px;display:grid;gap:9px}
#career-panel details[open]>summary{opacity:1}
#career-panel h2{margin:0;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:#dfeb98}
#career-panel .stats{font-variant-numeric:tabular-nums}
#career-panel ul{margin:0;padding:0;list-style:none;display:grid;gap:5px}
#career-panel li{display:grid;grid-template-columns:1fr auto;gap:8px;font-size:13px}
#career-panel li i{display:block;height:4px;border-radius:3px;background:#ffffff22;margin-top:3px}
#career-panel li i b{display:block;height:100%;border-radius:3px;background:#8ff0a8}
#career-panel .garage{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#career-panel .garage select{max-width:260px}
#career-panel label{font-size:13px;display:flex;gap:6px;align-items:center}
#career-panel input{width:auto}
#career-hud{margin-left:8px;color:#dfeb98;font-variant-numeric:tabular-nums}
#career-hud.debt{color:#ff9a7a}
#day-summary{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:8;width:min(420px,calc(100% - 24px));display:grid;gap:8px}
#day-summary[hidden]{display:none}
#day-summary h2{margin:0;font-size:18px;color:#dfeb98}
#day-summary table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
#day-summary td{padding:3px 0}#day-summary td:last-child{text-align:right}
#day-summary .out{color:#ffb09a}#day-summary .in{color:#9be8a8}#day-summary tr.total td{border-top:1px solid #ffffff40;padding-top:7px;font-weight:700}
#day-summary p{margin:0;font-size:13px;color:#d5ddc9}`;
  document.head.append(style);

  const panel = document.createElement('section');
  panel.id = 'career-panel';
  panel.className = 'panel';
  panel.innerHTML = `<div class="stats" id="career-stats"></div>
    <details><summary>Garage and goals</summary>
      <div id="career-next" class="muted"></div>
      <ul id="career-goals"></ul>
      <div class="garage"><select id="career-shop" aria-label="Cars for sale"></select>
        <button id="career-buy" type="button">Buy</button><span id="career-note" class="muted"></span></div>
    </details>`;
  // The less common switches live under Options on the menu.
  const switches = document.createElement('div');
  switches.className = 'graphics-settings';
  switches.style.flexDirection = 'column';
  switches.style.alignItems = 'flex-start';
  switches.innerHTML = `<label><input id="career-free" type="checkbox"> Free play (every car unlocked, no career)</label>
    <label><input id="career-home" type="checkbox"> Start the game in my flat (otherwise it is marked on the map)</label>`;
  byId('options').append(switches);
  byId('main-menu').querySelector('.menu-primary').after(panel);
  const day = document.createElement('section');
  day.id = 'day-summary'; day.className = 'panel'; day.hidden = true;
  document.body.append(day);
  let dayTimer = 0;
  const hud = document.createElement('span');
  hud.id = 'career-hud';
  byId('wallet').after(hud);

  const shop = byId('career-shop'), buy = byId('career-buy'), free = byId('career-free');
  const names = Object.fromEntries(cars.map(({key, name}) => [key, name]));
  const locked = () => cars.filter(({key}) => !career.state.owned.includes(key)).sort((a, b) => priceOf(a.key) - priceOf(b.key));

  function render() {
    const s = career.state, tier = career.tier, next = career.nextTier();
    free.checked = !s.enabled;
    byId('career-home').checked = s.home === true;
    panel.classList.toggle('free', !s.enabled);
    byId('career-stats').textContent = s.enabled ? `${money(s.cash)} · ${tier.name} ★ ${s.rating.toFixed(1)}` : `Free play · ${money(s.cash)}`;
    byId('career-next').textContent = s.enabled
      ? `${s.fares} fares · ${s.km.toFixed(0)} km` + (next ? ` · next: ${next.name} at ${next.fares} fares and ★ ${next.rating}` : '') : '';
    byId('career-goals').replaceChildren(...career.goals().filter(goal => !goal.done).slice(0, 3).map(goal => {
      const item = document.createElement('li');
      const share = Math.round(goal.progress / goal.target * 100);
      item.innerHTML = `<span>${goal.text}<i><b style="width:${share}%"></b></i></span><span>+${goal.reward} €</span>`;
      return item;
    }));
    const options = locked();
    shop.replaceChildren(...options.map(({key, name}) => new Option(`${name} · ${money(priceOf(key))}`, key)));
    shop.hidden = buy.hidden = !s.enabled || !options.length;
    const pick = shop.value;
    buy.disabled = !pick || !career.canAfford(pick);
    byId('career-note').textContent = !s.enabled ? '' : !options.length ? 'You own every car.'
      : s.debt > 0 ? `Clear ${money(s.debt)} of rent first` : pick && !career.canAfford(pick) ? `Need ${money(priceOf(pick) - s.cash)} more` : '';
    hud.textContent = s.enabled ? `${tier.name} · ★ ${s.rating.toFixed(1)}` + (s.debt > 0 ? ` · owes ${Math.round(s.debt)} €` : '') : '';
    hud.classList.toggle('debt', s.debt > 0);
  }
  shop.onchange = render;
  buy.onclick = () => {
    const key = shop.value;
    if (!key || !career.buy(key)) return;
    onChange({bought: key, message: `Bought the ${names[key]}.`});
    render();
  };
  const home = byId('career-home');
  home.onchange = () => { career.state.home = home.checked; career.save(); };
  free.onchange = () => { career.setEnabled(!free.checked); onChange({mode: true}); render(); };

  // The money on the HUD: one big total, a flash when it changes, and a small note only if rent is overdue.
  let lastCash = null;
  function hudTick() {
    const s = career.state;
    byId('money-cash').textContent = money(s.cash);
    byId('money-debt').textContent = s.debt > 0 ? `Overdue rent ${money(s.debt)}` : '';
    if (lastCash !== null && Math.round(s.cash) !== Math.round(lastCash)) {
      const delta = Math.round(s.cash - lastCash), flash = byId('money-flash');
      flash.textContent = `${delta > 0 ? '+' : '-'}${money(Math.abs(delta))}`;
      flash.className = delta > 0 ? 'gain' : 'loss';
      void flash.offsetWidth;
      flash.classList.add('show');
    }
    lastCash = s.cash;
  }

  // The books for the day that just ended: fares and tips in, fuel, fines, repairs and rent out.
  function showDay(summary) {
    const row = (label, value, kind) => value ? `<tr class="${kind || ''}"><td>${label}</td><td>${kind === 'out' ? '-' : kind === 'in' ? '+' : ''}${Math.round(Math.abs(value))} €</td></tr>` : '';
    const net = Math.round(summary.net);
    day.innerHTML = `<h2>Day ${summary.day} done</h2>
      <table>${row(`Fares (${summary.fares})`, summary.earned - summary.tips, 'in')}${row('Tips', summary.tips, 'in')}${row('Goals', summary.bonus, 'in')}
      ${row('Fuel', summary.fuel, 'out')}${row('Fines', summary.fines, 'out')}${row('Repairs', summary.repairs, 'out')}
      ${row('Rent', summary.paid, 'out')}
      <tr class="total"><td>${net >= 0 ? 'Profit' : 'Loss'} for the day</td><td class="${net >= 0 ? 'in' : 'out'}">${net >= 0 ? '+' : ''}${net} €</td></tr></table>
      <p>${summary.failed ? summary.failed + ' fare' + (summary.failed > 1 ? 's' : '') + ' lost. ' : ''}${summary.debt > 0
        ? `You could not cover the rent: ${Math.round(summary.debt)} € overdue. Clear it before buying anything.`
        : `Rent paid. You have ${Math.round(summary.cash)} €.`}</p>
      <button type="button" id="day-ok">OK</button>`;
    day.hidden = false;
    byId('day-ok').onclick = () => { day.hidden = true; };
    clearTimeout(dayTimer);
    dayTimer = setTimeout(() => { day.hidden = true; }, 20000);
    render();
  }

  // Locked cars stay listed with their price but cannot be picked.
  function paintSelector(select) {
    for (const option of select.options) {
      const name = names[option.value] ?? option.textContent;
      const owned = career.owns(option.value);
      option.disabled = !owned;
      option.textContent = owned ? name : `${name} · ${money(priceOf(option.value))}`;
    }
  }
  render();
  return {render, paintSelector, showDay, hudTick};
}
