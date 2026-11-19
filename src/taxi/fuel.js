// Fuel: every car has a tank, burns what its engine really uses, and fills up at a working pump.
const GRADES=[{key:'sp95',label:'SP95-E10',diesel:false,price:1.85},{key:'sp98',label:'SP98',diesel:false,price:1.95},{key:'gazole',label:'Gazole',diesel:true,price:1.75}];
const FLOW=.62; // litres per second through the nozzle, sped up from a real pump's 0.65 l/s only slightly

export const isDiesel=(key,spec)=>/diesel/i.test(spec.desc||'')||['transit_l2','citybus','fortuner','ranger'].includes(key);

export function fitTank(vehicle,key,share=.7) {
  const {spec}=vehicle;
  vehicle.tank=Math.round(Math.max(32,Math.min(spec.bus?220:95,spec.mass*.038)));
  vehicle.fuel=vehicle.tank*share;
  vehicle.diesel=isDiesel(key,spec);
  vehicle.misfuel=0;
}

export function createFuel(byId, wallet={money:400,charge(amount){this.money=Math.max(0,this.money-amount);}}) {
  let stop=null, vehicle=null, grade=0, pumped=0, holding=false, notice='';
  const panel=document.createElement('section');
  panel.id='pump';panel.className='panel';panel.hidden=true;
  panel.innerHTML=`<header><b id="pump-brand"></b><span id="pump-number"></span></header>
    <div class="pump-lcd"><div><small>Litres</small><output id="pump-litres">0.00</output></div><div><small>Price</small><output id="pump-price">0.00 €</output></div></div>
    <div id="pump-grades"></div>
    <div class="pump-tank"><i id="pump-level"></i></div><p id="pump-note"></p>
    <div class="pump-actions"><button id="pump-hold" type="button">Hold to pump (Space)</button><button id="pump-pay" type="button">Finish (Enter)</button></div>`;
  document.body.append(panel);
  const gradeButtons=GRADES.map((item,index)=>{
    const button=document.createElement('button');button.type='button';
    button.onclick=()=>{if(!pumped)grade=index;paint();};
    byId('pump-grades').append(button);
    return button;
  });
  const hold=byId('pump-hold');
  hold.onpointerdown=()=>{holding=true;};
  for(const name of ['pointerup','pointerleave','pointercancel'])hold.addEventListener(name,()=>{holding=false;});
  function paint() {
    if(!stop)return;
    GRADES.forEach((item,index)=>{
      gradeButtons[index].textContent=`${index+1} · ${item.label} · ${item.price.toFixed(2)} €/L`;
      gradeButtons[index].classList.toggle('chosen',index===grade);
      gradeButtons[index].disabled=pumped>0&&index!==grade;
    });
    byId('pump-litres').textContent=pumped.toFixed(2);
    byId('pump-price').textContent=`${(pumped*GRADES[grade].price).toFixed(2)} €`;
    byId('pump-level').style.width=`${vehicle.fuel/vehicle.tank*100}%`;
    byId('pump-note').textContent=notice||`This car takes ${vehicle.diesel?'diesel (Gazole)':'petrol (SP95 or SP98)'}.`;
  }
  function close() {
    stop=null;holding=false;panel.hidden=true;
  }
  function pay() {
    if(!stop)return;
    if(pumped>.2&&GRADES[grade].diesel!==vehicle.diesel)vehicle.misfuel=1;
    const bill=pumped*GRADES[grade].price;
    if(bill>0)(wallet.spend?wallet.spend('fuel',bill):wallet.charge(bill));
    close();
  }
  return {
    get open(){return Boolean(stop);},
    get pumping(){return Boolean(stop)&&holding;},
    get money(){return wallet.money;},
    charge(amount){wallet.charge(amount);},
    begin(target,car) {
      stop=target;vehicle=car;pumped=0;notice='';
      grade=car.diesel?2:0;
      byId('pump-brand').textContent=target.pad.brand.name;
      byId('pump-brand').style.color='#'+target.pad.brand.color.toString(16).padStart(6,'0');
      byId('pump-number').textContent=`Pump ${target.number}`;
      panel.hidden=false;paint();
    },
    key(event,down) {
      if(!stop)return false;
      if(event.code==='Space'){holding=down;event.preventDefault();return true;}
      if(!down)return true;
      if(event.key==='Enter'||event.key==='f'){pay();return true;}
      if(event.key==='Escape'){if(!pumped)close();else pay();return true;}
      if(['1','2','3'].includes(event.key)&&!pumped){grade=Number(event.key)-1;paint();}
      return true;
    },
    step(dt) {
      if(!stop)return;
      if(holding){
        const price=GRADES[grade].price;
        const affordable=(wallet.money-pumped*price)/price;
        const litres=Math.min(FLOW*dt*6,vehicle.tank-vehicle.fuel,Math.max(0,affordable));
        if(litres>0){vehicle.fuel+=litres;pumped+=litres;notice='';}
        else notice=affordable<=0?'Not enough cash for more fuel.':'Tank full.';
        paint();
      }
    },
    payButton:byId('pump-pay'),pay,
    hud(car) {
      const share=car.fuel/car.tank;
      byId('fuel-level').style.width=`${share*100}%`;
      byId('fuel-level').classList.toggle('low',share<.15);
      byId('fuel-text').textContent=car.fuel<=.01?'Empty':`${Math.round(car.fuel)} L`;
      byId('wallet').textContent=`${Math.round(wallet.money)} €`;
    },
  };
}
