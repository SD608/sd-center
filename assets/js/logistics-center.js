(() => {
  const KEY = "sd_logistics_center_web_progress_v100";
  const OLD_KEY = "sd_logistics_center_expansion_season0_v101";

  // Economy Balance v2
  const DIRECT_PAYOUT_MULTIPLIER = 0.15;
  const DRIVER_PAYOUT_MULTIPLIER = 0.10;
  const DELIVERY_DURATION_MULTIPLIER = 4;
  const DRIVER_DURATION_MULTIPLIER = 4;
  const FAST_DELIVERY_BONUS_MULTIPLIER = 1.10;

  // 적재 스택: 소형 1 / 중형 3 / 대형 6 / 초대형 12
  // 작은 차량일수록 속도가 빠릅니다.
  const vehicleTypes = [
    {key:"small",  label:"소형",   name:"소형 밴",         cost:250000,  order:0, stack:1,  speed:1.00, desc:"적재 1스택 · 가장 빠름"},
    {key:"medium", label:"중형",   name:"중형 트럭",       cost:700000,  order:1, stack:3,  speed:0.86, desc:"적재 3스택 · 빠름"},
    {key:"large",  label:"대형",   name:"대형 카고",       cost:1500000, order:2, stack:6,  speed:0.72, desc:"적재 6스택 · 보통"},
    {key:"xlarge", label:"초대형", name:"초대형 트레일러", cost:3000000, order:3, stack:12, speed:0.58, desc:"적재 12스택 · 가장 느림"},
  ];
  const ranks = [
    {rank:"F", min:0, next:100},
    {rank:"E", min:100, next:260},
    {rank:"D", min:260, next:520},
    {rank:"C", min:520, next:900},
    {rank:"B", min:900, next:1450},
    {rank:"A", min:1450, next:2200},
    {rank:"S", min:2200, next:null},
  ];
  const headquartersLevels = {
    2:{contracts:35, xlarge:3, revenue:4000000, fleet:6, fee:500000, unlock:"기사 시스템 · 정원 2명"},
    3:{contracts:50, xlarge:5, revenue:7000000, fleet:8, fee:750000, unlock:"차량 슬롯 10대"},
    4:{contracts:70, xlarge:8, revenue:11000000, fleet:8, fee:1000000, unlock:"기사 정원 4명"},
    5:{contracts:95, xlarge:12, revenue:17000000, fleet:8, fee:1500000, unlock:"장거리 계약"},
    6:{contracts:125, xlarge:16, revenue:25000000, fleet:8, fee:2000000, unlock:"기사 정원 6명 · 물류창고"},
    7:{contracts:160, xlarge:21, revenue:35000000, fleet:8, fee:3000000, unlock:"본부 경영 특성 강화"},
    8:{contracts:200, xlarge:27, revenue:48000000, fleet:10, fee:4000000, unlock:"기사 정원 8명 · 해외 화물"},
    9:{contracts:245, xlarge:34, revenue:65000000, fleet:10, fee:5500000, unlock:"차량 슬롯 12대"},
    10:{contracts:300, xlarge:42, revenue:90000000, fleet:12, fee:8000000, unlock:"기사 정원 10명 · 대형 물류기업"}
  };
  const headquartersUnlocks = [
    {level:1, text:"물류 본부 개설"},
    {level:2, text:"기사 자동수익 · 2명"},
    {level:3, text:"차량 슬롯 10대"},
    {level:4, text:"기사 정원 4명"},
    {level:5, text:"장거리 계약"},
    {level:6, text:"기사 정원 6명 · 물류창고"},
    {level:7, text:"본부 특성 강화"},
    {level:8, text:"기사 정원 8명 · 해외 화물"},
    {level:9, text:"차량 슬롯 12대"},
    {level:10, text:"기사 정원 10명 · 대형 물류기업"}
  ];

  const driverMissions = [
    {id:"local", level:2, name:"지역 상점 정기배송", seconds:14, base:22000, desc:"기사 전용 소형 정기 노선"},
    {id:"business", level:4, name:"기업 업무화물 운송", seconds:20, base:38000, desc:"기업 문서·업무용 소형 화물"},
    {id:"industrial", level:6, name:"산업단지 순환배송", seconds:27, base:65000, desc:"산업단지 내부 정기 운송"},
    {id:"port", level:8, name:"항만 연계 셔틀", seconds:36, base:105000, desc:"항만과 물류거점 사이 기사 전용 임무"}
  ];
  const starterVehicle = () => ({
    id: crypto.randomUUID(),
    type: "small",
    name: "SD 스타터 밴",
    purchaseCost: 0,
    starter: true,
    acquiredAt: Date.now()
  });

  const baseState = {
    balance:0,
    logisticsRep:0,
    completedContracts:0,
    autoFitEnabled:true,
    headquartersLevel:0,
    logisticsRevenue:0,
    xlargeCompleted:0,
    warehouseOwned:false,
    employees:[],
    driverRevenue:0,
    hqPerks:{driverIncome:0,directIncome:0,driverSpeed:0},
    hqPerkPoints:0,
    hqUiOpen:{
      upgrade:true,
      perks:true,
      roadmap:false,
      drivers:true,
      warehouse:false
    },
    logisticsUiOpen:{
      contracts:true,
      fleet:true
    },
    fleet:[starterVehicle()],
    activeDeliveries:[],
    ledger:[],
    contracts:[],
    delivery:null
  };
  let state = load();
  let modalCleanup = null;

  function load(){
    try{
      const normalizeEmployees=(list)=>(Array.isArray(list)?list:[]).map(e=>({
        id:e.id||crypto.randomUUID(),
        name:e.name||"SD 기사",
        hiredAt:e.hiredAt||Date.now(),
        missionId:e.missionId||null,
        active:!!e.active,
        nextPayoutAt:Number(e.nextPayoutAt)||null,
        totalEarned:Number(e.totalEarned)||0
      }));

      const normalizeDeliveries=(list)=>(Array.isArray(list)?list:[]).map(d=>({
        ...d,
        vehicleIds:Array.isArray(d.vehicleIds)?d.vehicleIds:(d.vehicleId?[d.vehicleId]:[]),
        driverId:null,
        autoManaged:false
      }));

      const normalizeFleet=(fleet,limit)=>(Array.isArray(fleet)&&fleet.length?fleet:[starterVehicle()])
        .slice(0,limit)
        .map((v,i)=>({
          id:v.id||crypto.randomUUID(),
          type:v.type||"small",
          name:v.name||vehicleTypes.find(x=>x.key===(v.type||"small"))?.name||"차량",
          purchaseCost:Number.isFinite(v.purchaseCost)?v.purchaseCost:(vehicleTypes.find(x=>x.key===v.type)?.cost||0),
          starter:!!v.starter||i===0,
          acquiredAt:v.acquiredAt||Date.now()
        }));

      const normalizePerks=(p)=>({
        driverIncome:Math.max(0,Number(p?.driverIncome)||0),
        directIncome:Math.max(0,Number(p?.directIncome)||0),
        driverSpeed:Math.max(0,Number(p?.driverSpeed)||0)
      });

      const raw=localStorage.getItem(KEY);
      if(raw){
        const parsed=JSON.parse(raw);
        const hq=Number(parsed.headquartersLevel)||0;
        const fleetMax=hq>=9?12:hq>=3?10:8;
        return {
          ...baseState,
          ...parsed,
          autoFitEnabled:parsed.autoFitEnabled!==false,
          headquartersLevel:hq,
          logisticsRevenue:Number(parsed.logisticsRevenue)||0,
          xlargeCompleted:Number(parsed.xlargeCompleted)||0,
          warehouseOwned:!!parsed.warehouseOwned,
          employees:normalizeEmployees(parsed.employees),
          driverRevenue:Number(parsed.driverRevenue)||0,
          hqPerks:normalizePerks(parsed.hqPerks),
          hqPerkPoints:Math.max(0,Number(parsed.hqPerkPoints)||0),
          hqUiOpen:{
            upgrade:parsed.hqUiOpen?.upgrade !== false,
            perks:parsed.hqUiOpen?.perks !== false,
            roadmap:!!parsed.hqUiOpen?.roadmap,
            drivers:parsed.hqUiOpen?.drivers !== false,
            warehouse:!!parsed.hqUiOpen?.warehouse
          },
          logisticsUiOpen:{
            contracts:parsed.logisticsUiOpen?.contracts !== false,
            fleet:parsed.logisticsUiOpen?.fleet !== false
          },
          fleet:normalizeFleet(parsed.fleet,fleetMax),
          activeDeliveries:normalizeDeliveries(parsed.activeDeliveries)
        };
      }

      const oldRaw=localStorage.getItem(OLD_KEY);
      if(oldRaw){
        const old=JSON.parse(oldRaw);
        const hq=Number(old.headquartersLevel)||0;
        const oldLedger=Array.isArray(old.ledger)?old.ledger:[];
        const derivedRevenue=Number(old.logisticsRevenue)||
          oldLedger
            .filter(x=>Number(x.amount)>0 && String(x.desc||"").startsWith("SD 물류회사"))
            .reduce((sum,x)=>sum+Number(x.amount||0),0);

        return {
          ...structuredClone(baseState),
          ...old,
          logisticsRevenue:derivedRevenue,
          employees:normalizeEmployees(old.employees),
          driverRevenue:0,
          hqPerks:old.hqPerks ? normalizePerks(old.hqPerks) : {driverIncome:0,directIncome:0,driverSpeed:0},
          hqPerkPoints:Number.isFinite(Number(old.hqPerkPoints)) ? Number(old.hqPerkPoints) : Math.max(0,hq-1),
          hqUiOpen:old.hqUiOpen ? {
            upgrade:old.hqUiOpen.upgrade !== false,
            perks:old.hqUiOpen.perks !== false,
            roadmap:!!old.hqUiOpen.roadmap,
            drivers:old.hqUiOpen.drivers !== false,
            warehouse:!!old.hqUiOpen.warehouse
          } : {
            upgrade:true,
            perks:true,
            roadmap:false,
            drivers:true,
            warehouse:false
          },
          logisticsUiOpen:{
            contracts:true,
            fleet:true
          },
          fleet:normalizeFleet(old.fleet,hq>=9?12:hq>=3?10:8),
          activeDeliveries:normalizeDeliveries(old.activeDeliveries),
          contracts:[]
        };
      }
    }catch(e){}
    return structuredClone(baseState);
  }
  let onlineAuth=null;
  let onlineSession=null;
  let onlineProfile=null;
  let onlineWallet=null;
  let serverTransactions=[];
  let serverReady=false;
  let progressSaveTimer=null;
  const deliverySettling=new Set();
  const driverSettling=new Set();

  function progressPayload(){
    const copy=structuredClone(state);
    delete copy.balance;
    delete copy.ledger;
    return copy;
  }

  function queueServerProgressSave(){
    if(!serverReady || !onlineSession?.user?.id || !onlineAuth)return;
    clearTimeout(progressSaveTimer);
    progressSaveTimer=setTimeout(async()=>{
      try{
        const {error}=await onlineAuth.client
          .from("sd_logistics_progress")
          .upsert({
            user_id:onlineSession.user.id,
            state:progressPayload(),
            updated_at:new Date().toISOString()
          },{onConflict:"user_id"});
        if(error)throw error;
      }catch(error){
        console.warn("물류 진행도 서버 저장 실패",error?.message||error);
      }
    },350);
  }

  function save(){
    try{
      const localCopy=progressPayload();
      localStorage.setItem(KEY,JSON.stringify(localCopy));
    }catch(_){}
    queueServerProgressSave();
  }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const won = (n) => Math.round(n).toLocaleString("ko-KR")+"원";
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

  function addLedger(){ /* 서버 transactions 장부를 사용합니다. */ }

  function setOnlineStatus(message,type=""){
    const el=$("#onlineStatus");
    if(!el)return;
    el.textContent=message;
    el.className=`online-status ${type}`.trim();
  }

  async function refreshOnlineWallet({renderAfter=true,ledger=true}={}){
    if(!onlineAuth)return null;
    const {data,error}=await onlineAuth.client
      .from("wallets")
      .select("id,account_number,balance,updated_at")
      .single();
    if(error)throw error;
    onlineWallet=data;
    state.balance=Number(data.balance||0);
    const balanceEl=$("#walletBalance");
    const accountEl=$("#walletAccountNumber");
    if(balanceEl)balanceEl.textContent=won(state.balance);
    if(accountEl)accountEl.textContent=`SD 가상계좌 ${data.account_number}`;
    if(ledger)await refreshServerLedger();
    if(renderAfter)render();
    return data;
  }

  async function refreshServerLedger(){
    if(!onlineAuth)return;
    const {data,error}=await onlineAuth.client
      .from("transactions")
      .select("id,description,amount,balance_after,platform,created_at")
      .order("created_at",{ascending:false})
      .limit(30);
    if(error)throw error;
    serverTransactions=data||[];
    renderLedger();
  }

  function renderLedger(){
    const host=$("#ledger");
    if(!host)return;
    if(!serverTransactions.length){
      host.innerHTML='<div class="muted">아직 거래 내역이 없습니다.</div>';
      return;
    }
    host.innerHTML=serverTransactions.map(tx=>{
      const amount=Number(tx.amount||0);
      const time=new Intl.DateTimeFormat("ko-KR",{
        month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
      }).format(new Date(tx.created_at));
      return `<article class="ledger-row">
        <div>
          <strong>${tx.description||"SD 가상거래"}</strong>
          <small>${time}<span class="tx-platform">${String(tx.platform||"web").toUpperCase()}</span> · 잔액 ${won(tx.balance_after)}</small>
        </div>
        <strong class="${amount>0?"plus":"minus"}">${amount>0?"+":""}${won(amount)}</strong>
      </article>`;
    }).join("");
  }

  function uuid(){
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function applyWalletEvent(eventKey,referenceId,amount,metadata={}){
    if(!onlineAuth||!onlineSession)throw new Error("로그인이 필요합니다.");
    setOnlineStatus("SD지갑에 반영하는 중…","busy");
    const {data,error}=await onlineAuth.client.rpc("apply_sd_logistics_wallet_event",{
      p_event_key:eventKey,
      p_reference_id:String(referenceId),
      p_amount:Math.trunc(amount),
      p_request_id:uuid(),
      p_metadata:metadata||{}
    });
    if(error)throw error;
    state.balance=Number(data.balance_after||0);
    onlineWallet={...(onlineWallet||{}),balance:state.balance};
    if($("#walletBalance"))$("#walletBalance").textContent=won(state.balance);
    await refreshServerLedger();
    setOnlineStatus("공용 SD지갑과 동기화됨","success");
    return data;
  }

  function toast(msg){
    const el=$("#toast"); el.textContent=msg; el.classList.remove("hidden");
    clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.add("hidden"),2300);
  }

  function vehicleEventKey(prefix,type){
    return `${prefix}_${type}`;
  }

  function starterUpgradeEventKey(currentType,nextType){
    return `starter_upgrade_${currentType}_${nextType}`;
  }

  function ensureHeadquartersUnlock(){
    if(rankFromRep(state.logisticsRep).rank==="S" && state.headquartersLevel<1){
      state.headquartersLevel=1;
      save();
      toast("S등급 달성 · SD 물류 본부 Lv.1이 해금되었습니다.");
    }
  }

  function fleetLimit(){
    if(state.headquartersLevel>=9)return 12;
    if(state.headquartersLevel>=3)return 10;
    return 8;
  }

  function driverLimit(){
    if(state.headquartersLevel<2)return 0;
    return Math.floor(state.headquartersLevel/2)*2;
  }

  function businessRevenueMultiplier(){
    let mult=DIRECT_PAYOUT_MULTIPLIER;
    if(state.warehouseOwned)mult*=1.10;
    if(state.headquartersLevel>=10)mult*=1.10;
    mult*=1+(state.hqPerks.directIncome||0)*0.05;
    return mult;
  }

  function driverIncomeMultiplier(){
    let mult=DRIVER_PAYOUT_MULTIPLIER;
    if(state.warehouseOwned)mult*=1.10;
    if(state.headquartersLevel>=10)mult*=1.10;
    mult*=1+(state.hqPerks.driverIncome||0)*0.10;
    return mult;
  }

  function driverMissionDuration(mission){
    const reduction=Math.min(0.45,(state.hqPerks.driverSpeed||0)*0.08);
    return Math.max(12,Math.round(mission.seconds*DRIVER_DURATION_MULTIPLIER*(1-reduction)));
  }

  function driverMissionPayout(mission){
    return Math.round(mission.base*driverIncomeMultiplier());
  }

  function driverById(id){
    return state.employees.find(e=>e.id===id)||null;
  }

  function availableDriverMissions(){
    return driverMissions.filter(m=>state.headquartersLevel>=m.level);
  }

  function hqRequirementsMet(level){
    const r=headquartersLevels[level];
    if(!r)return false;
    return state.completedContracts>=r.contracts &&
      state.xlargeCompleted>=r.xlarge &&
      state.logisticsRevenue>=r.revenue &&
      state.fleet.length>=r.fleet &&
      state.balance>=r.fee;
  }

  async function upgradeHeadquarters(){
    const next=state.headquartersLevel+1;
    const r=headquartersLevels[next];
    if(!r||!hqRequirementsMet(next)){
      toast("본부 승급 조건이 충족되지 않았습니다.");
      return;
    }
    try{
      await applyWalletEvent(`hq_upgrade_${next}`,`hq-level-${next}`,-r.fee,{level:next});
      state.headquartersLevel=next;
      state.hqPerkPoints=(state.hqPerkPoints||0)+1;
      save();
      render();
      toast(`물류 본부 Lv.${next} 달성 · 특성 포인트 +1 · ${r.unlock} 해금`);
    }catch(error){
      setOnlineStatus(error?.message||"본부 승급 결제 실패","error");
      toast(error?.message||"본부 승급 결제 실패");
      await refreshOnlineWallet({renderAfter:true,ledger:true}).catch(()=>{});
    }
  }

  function chooseHqPerk(kind){
    if(state.hqPerkPoints<=0){toast("사용 가능한 본부 특성 포인트가 없습니다.");return;}
    if(!["driverIncome","directIncome","driverSpeed"].includes(kind))return;
    state.hqPerks[kind]=(state.hqPerks[kind]||0)+1;
    state.hqPerkPoints--;
    save();
    render();
    const label=kind==="driverIncome"?"기사 수익 +10%":kind==="directIncome"?"직접 배송 수익 +5%":"기사 임무시간 -8%";
    toast(`본부 특성 적용 · ${label}`);
  }

  function resetHqPerks(){
    const spent=(state.hqPerks.driverIncome||0)+(state.hqPerks.directIncome||0)+(state.hqPerks.driverSpeed||0);
    if(spent<=0){
      toast("초기화할 본부 특성이 없습니다.");
      return;
    }
    if(!confirm(`본부 특성을 초기화할까요?\n사용한 특성 포인트 ${spent}개가 모두 반환됩니다.`))return;

    state.hqPerkPoints+=spent;
    state.hqPerks={driverIncome:0,directIncome:0,driverSpeed:0};
    save();
    render();
    toast(`본부 특성 초기화 완료 · ${spent}포인트 반환`);
  }

  async function hireDriver(){
    if(state.headquartersLevel<2){toast("물류 본부 Lv.2부터 기사를 고용할 수 있습니다.");return;}
    if(state.employees.length>=driverLimit()){toast("현재 본부 레벨의 기사 정원이 가득 찼습니다.");return;}

    const family=["김","이","박","최","정","강","조","윤","장","임"];
    const given=["도윤","민준","서준","지훈","현우","준호","태윤","승민","민재","우진"];
    const name=family[Math.floor(Math.random()*family.length)]+given[Math.floor(Math.random()*given.length)];
    const cost=300000;
    const driverId=uuid();

    if(state.balance<cost){toast(`기사 채용에 ${won(cost)}이 필요합니다.`);return;}
    if(!confirm(`${name} 기사\n채용비 ${won(cost)}\n공용 SD지갑에서 결제할까요?`))return;

    try{
      await applyWalletEvent("driver_hire",`driver-${driverId}`,-cost,{driver_id:driverId,driver_name:name});
      state.employees.push({
        id:driverId,name,hiredAt:Date.now(),
        missionId:null,active:false,nextPayoutAt:null,totalEarned:0
      });
      save();render();
      toast(`${name} 기사 채용 완료`);
    }catch(error){
      setOnlineStatus(error?.message||"기사 채용 결제 실패","error");
      toast(error?.message||"기사 채용 결제 실패");
    }
  }

  function fireDriver(id){
    const d=driverById(id);
    if(!d)return;
    if(d.active){toast("근무 중인 기사는 먼저 근무를 중지해야 합니다.");return;}
    if(!confirm(`${d.name} 기사를 해고할까요?`))return;
    state.employees=state.employees.filter(e=>e.id!==id);
    save();
    render();
    toast(`${d.name} 기사 계약 종료`);
  }

  function startDriverMission(driverId,missionId){
    const d=driverById(driverId);
    const m=driverMissions.find(x=>x.id===missionId);
    if(!d||!m)return;
    if(state.headquartersLevel<m.level){toast("아직 해금되지 않은 기사 임무입니다.");return;}

    d.missionId=m.id;
    d.active=true;
    d.nextPayoutAt=Date.now()+driverMissionDuration(m)*1000;
    save();
    renderHeadquarters();
    toast(`${d.name} 기사 · ${m.name} 자동근무 시작`);
  }

  function stopDriverMission(driverId){
    const d=driverById(driverId);
    if(!d)return;
    d.active=false;
    d.nextPayoutAt=null;
    save();
    renderHeadquarters();
    toast(`${d.name} 기사 근무 중지`);
  }

  async function settleDriverMission(driver,mission,dueAt){
    if(driverSettling.has(driver.id))return;
    driverSettling.add(driver.id);
    const payout=driverMissionPayout(mission);
    const ref=`driver-${driver.id}-${dueAt}`;
    try{
      await applyWalletEvent("driver_income",ref,payout,{
        driver_id:driver.id,
        driver_name:driver.name,
        mission_id:mission.id,
        mission_name:mission.name,
        due_at:dueAt
      });
      state.driverRevenue+=payout;
      state.logisticsRevenue+=payout;
      driver.totalEarned=(driver.totalEarned||0)+payout;
      driver.nextPayoutAt=dueAt+driverMissionDuration(mission)*1000;
      save();
      renderHeadquarters();
    }catch(error){
      setOnlineStatus(error?.message||"기사 수익 정산 실패","error");
      // 실패 시 잠시 뒤 같은 정산을 다시 시도합니다.
      driver.nextPayoutAt=Math.max(Date.now()+2000,dueAt);
      save();
    }finally{
      driverSettling.delete(driver.id);
    }
  }

  function tickDriverMissions(){
    const now=Date.now();
    for(const d of state.employees){
      if(!d.active||!d.missionId)continue;
      const m=driverMissions.find(x=>x.id===d.missionId);
      if(!m||state.headquartersLevel<m.level){
        d.active=false;d.nextPayoutAt=null;save();continue;
      }
      const duration=driverMissionDuration(m)*1000;
      if(!d.nextPayoutAt){d.nextPayoutAt=now+duration;save();}
      if(d.nextPayoutAt<=now && !driverSettling.has(d.id)){
        void settleDriverMission(d,m,d.nextPayoutAt);
      }

      const remain=Math.max(0,d.nextPayoutAt-now);
      const remainEl=$(`[data-driver-remain="${d.id}"]`);
      const bar=$(`[data-driver-bar="${d.id}"]`);
      if(remainEl)remainEl.textContent=`${Math.ceil(remain/1000)}초`;
      if(bar)bar.style.width=`${clamp((1-remain/duration)*100,0,100)}%`;
    }
  }
  setInterval(tickDriverMissions,250);

  async function buyWarehouse(){
    const cost=3000000;
    if(state.headquartersLevel<6){toast("물류 본부 Lv.6부터 물류창고를 구매할 수 있습니다.");return;}
    if(state.warehouseOwned){toast("이미 물류창고를 보유하고 있습니다.");return;}
    if(state.balance<cost){toast("물류창고 구매 자금이 부족합니다.");return;}
    if(!confirm(`물류창고를 ${won(cost)}에 구매할까요?\n공용 SD지갑에서 결제됩니다.`))return;
    try{
      await applyWalletEvent("warehouse_buy","warehouse-main",-cost,{warehouse:"main"});
      state.warehouseOwned=true;
      save();render();
      toast("물류창고 가동 · 물류 수익 +10%");
    }catch(error){
      setOnlineStatus(error?.message||"물류창고 구매 실패","error");
      toast(error?.message||"물류창고 구매 실패");
    }
  }

  // ===========================================================================
  // PC · SD 물류회사 v0.4
  // - 차량 최대 8대
  // - 적재 스택: 소형1 / 중형3 / 대형6 / 초대형12
  // - 여러 차량을 합쳐 한 계약 수행 가능
  // - 스타터 차량 크기 업그레이드
  // - 작은 차량일수록 더 빠름
  // - 운송 중에도 계약 새로고침 가능
  // - 진행 중 계약은 화면 왼쪽 상단 LIVE LOGISTICS에 표시
  // ===========================================================================

  function vehicleDef(type){
    return vehicleTypes.find(v=>v.key===type) || vehicleTypes[0];
  }
  function vehicleLabel(vehicle){
    const def=vehicleDef(vehicle.type);
    return `${def.label} · ${vehicle.name || def.name}`;
  }
  function isVehicleBusy(vehicleId){
    return state.activeDeliveries.some(d => (d.vehicleIds || []).includes(vehicleId));
  }
  function activeDeliveryByVehicle(vehicleId){
    return state.activeDeliveries.find(d => (d.vehicleIds || []).includes(vehicleId)) || null;
  }
  function fleetStack(vehicleIds){
    return vehicleIds.reduce((sum,id)=>{
      const v=state.fleet.find(x=>x.id===id);
      return sum+(v?vehicleDef(v.type).stack:0);
    },0);
  }
  function convoySpeed(vehicleIds){
    // 가장 느린 차량에 맞춰 움직이는 호송대 구조
    const speeds=vehicleIds.map(id=>{
      const v=state.fleet.find(x=>x.id===id);
      return v ? vehicleDef(v.type).speed : 1;
    });
    return speeds.length ? Math.min(...speeds) : 1;
  }
  function speedLabel(speed){
    if(speed>=.97)return "매우 빠름";
    if(speed>=.83)return "빠름";
    if(speed>=.68)return "보통";
    return "느림";
  }
  function speedClass(speed){
    if(speed>=.97)return "speed-very-fast";
    if(speed>=.83)return "speed-fast";
    if(speed>=.68)return "speed-normal";
    return "speed-slow";
  }
  function idleFleet(){
    return state.fleet.filter(v=>!isVehicleBusy(v.id));
  }

  function findBestVehicleCombo(requiredStack){
    const idle=idleFleet();
    if(!idle.length)return null;

    let best=null;
    const n=idle.length;

    // 차량 최대 8대라 완전탐색해도 최대 255조합이라 충분히 가볍습니다.
    for(let mask=1; mask<(1<<n); mask++){
      const ids=[];
      let stack=0;
      let minSpeed=1;
      for(let i=0;i<n;i++){
        if(mask&(1<<i)){
          const v=idle[i];
          const def=vehicleDef(v.type);
          ids.push(v.id);
          stack+=def.stack;
          minSpeed=Math.min(minSpeed,def.speed);
        }
      }
      if(stack<requiredStack)continue;

      const candidate={
        vehicleIds:ids,
        stack,
        excess:stack-requiredStack,
        count:ids.length,
        speed:minSpeed
      };

      // 1) 초과 스택 최소
      // 2) 차량 수 최소
      // 3) 같은 조건이면 더 빠른 조합
      const better=!best ||
        candidate.excess < best.excess ||
        (candidate.excess===best.excess && candidate.count < best.count) ||
        (candidate.excess===best.excess && candidate.count===best.count && candidate.speed > best.speed);

      if(better)best=candidate;
    }
    return best;
  }

  function comboDescription(combo){
    if(!combo)return "배차 가능한 조합 없음";
    const counts={small:0,medium:0,large:0,xlarge:0};
    combo.vehicleIds.forEach(id=>{
      const v=state.fleet.find(x=>x.id===id);
      if(v)counts[v.type]=(counts[v.type]||0)+1;
    });
    const parts=vehicleTypes
      .filter(def=>counts[def.key])
      .map(def=>`${def.label} ${counts[def.key]}대`);
    return `${parts.join(" + ")} · ${combo.stack}스택 · ${speedLabel(combo.speed)}`;
  }

  function generateContracts(){
    const normalPool = [
      {from:"순천",to:"광주",cargo:"전자제품 소포",base:52000,rep:22,minRank:"F",risk:"일반",requiredStack:1,category:"일반"},
      {from:"광주",to:"목포",cargo:"편의점 냉장품",base:76000,rep:28,minRank:"F",risk:"냉장",requiredStack:2,category:"일반"},
      {from:"여수",to:"순천",cargo:"산업부품 팔레트",base:118000,rep:36,minRank:"E",risk:"산업",requiredStack:3,category:"일반"},
      {from:"광주",to:"전주",cargo:"정밀기기",base:160000,rep:45,minRank:"E",risk:"취급주의",requiredStack:4,category:"일반"},
      {from:"목포",to:"대전",cargo:"건축 자재",base:255000,rep:62,minRank:"D",risk:"중량",requiredStack:6,category:"일반"},
      {from:"광주",to:"부산",cargo:"대형 기계부품",base:350000,rep:74,minRank:"C",risk:"대형",requiredStack:8,category:"일반"},
      {from:"부산",to:"광주",cargo:"산업용 발전기",base:565000,rep:92,minRank:"B",risk:"초대형",requiredStack:12,category:"일반"},
      {from:"여수",to:"서울",cargo:"특급 플랜트 장비",base:710000,rep:112,minRank:"A",risk:"특급",requiredStack:12,category:"일반"},
    ];

    const longhaulPool = [
      {from:"광주",to:"서울",cargo:"장거리 전자부품",base:900000,rep:135,minRank:"S",risk:"장거리",requiredStack:12,category:"장거리"},
      {from:"여수",to:"인천",cargo:"장거리 산업설비",base:1150000,rep:160,minRank:"S",risk:"장거리",requiredStack:15,category:"장거리"},
      {from:"부산",to:"목포",cargo:"장거리 냉장화물",base:980000,rep:145,minRank:"S",risk:"장거리",requiredStack:12,category:"장거리"},
    ];

    const overseasPool = [
      {from:"광양항",to:"오사카",cargo:"수출 정밀장비",base:1650000,rep:210,minRank:"S",risk:"해외",requiredStack:18,category:"해외"},
      {from:"부산항",to:"요코하마",cargo:"수출 산업기계",base:2050000,rep:250,minRank:"S",risk:"해외",requiredStack:24,category:"해외"},
      {from:"광양항",to:"상하이",cargo:"대형 수출화물",base:2350000,rep:280,minRank:"S",risk:"해외",requiredStack:24,category:"해외"},
    ];

    let pool=[...normalPool];
    if(state.headquartersLevel>=5)pool.push(...longhaulPool);
    if(state.headquartersLevel>=8)pool.push(...overseasPool);

    const count=state.headquartersLevel>=8?8:state.headquartersLevel>=5?7:6;
    state.contracts=[...pool].sort(()=>Math.random()-.5).slice(0,count)
      .map(x=>({...x,id:crypto.randomUUID()}));
    save();
  }
  function ensureContracts(){ if(!state.contracts?.length) generateContracts(); }

  function activeDeliveryProgress(delivery){
    const now=Date.now();
    const remain=Math.max(0,delivery.endAt-now);
    const elapsed=Math.max(0,now-delivery.startedAt);
    return {
      remain,
      seconds:Math.ceil(remain/1000),
      pct:clamp((elapsed/delivery.durationMs)*100,0,100)
    };
  }

  function renderActiveDeliveryDock(){
    const dock=$("#activeDeliveryDock");
    const host=$("#activeDeliveryDockList");
    const count=$("#activeDeliveryDockCount");
    if(!dock||!host||!count)return;

    if(!state.activeDeliveries.length){
      dock.classList.add("hidden");
      host.innerHTML="";
      count.textContent="0건";
      return;
    }

    dock.classList.remove("hidden");
    count.textContent=`${state.activeDeliveries.length}건`;
    host.innerHTML=state.activeDeliveries.map(d=>{
      const c=d.snapshot || {};
      const p=activeDeliveryProgress(d);
      const names=(d.vehicleIds||[]).map(id=>{
        const v=state.fleet.find(x=>x.id===id);
        return v ? vehicleDef(v.type).label : "?";
      }).join(" + ");
      return `<article class="dock-delivery">
        <div class="dock-delivery-top">
          <div>
            <h5>${c.from||"?"} → ${c.to||"?"}</h5>
            <p>${c.cargo||"화물"} · ${names} · 직접 배차</p>
          </div>
          <span class="dock-delivery-time" data-dock-remain="${d.id}">${p.seconds}초</span>
        </div>
        <div class="progress"><div data-dock-bar="${d.id}" style="width:${p.pct}%"></div></div>
      </article>`;
    }).join("");
  }

  function renderContracts(){
    const currentRank=rankFromRep(state.logisticsRep).rank;
    const idx=rankIndex(currentRank);

    $("#refreshContractsBtn").disabled=false;
    $("#refreshContractsBtn").textContent="계약 새로고침";

    $("#contracts").innerHTML=state.contracts.map(c=>{
      const lockedByRank=idx<rankIndex(c.minRank);
      const idle=idleFleet();
      const totalIdleStack=idle.reduce((sum,v)=>sum+vehicleDef(v.type).stack,0);
      const insufficient=totalIdleStack<c.requiredStack;
      const autoCombo=findBestVehicleCombo(c.requiredStack);

      const options=idle.map(v=>{
        const def=vehicleDef(v.type);
        return `<label class="contract-fleet-option">
          <input type="checkbox" data-contract-vehicle="${c.id}" value="${v.id}">
          <span>
            <strong>${def.label} · ${v.name||def.name}</strong>
            <small>${def.stack}스택 · <span class="speed-badge ${speedClass(def.speed)}">${speedLabel(def.speed)}</span></small>
          </span>
        </label>`;
      }).join("");

      const baseDisabled=lockedByRank||insufficient;
      const disabledReason=lockedByRank
        ? `회사 등급 ${c.minRank} 필요`
        : insufficient
          ? `대기 차량 적재량 부족 (${totalIdleStack}/${c.requiredStack})`
          : "";

      const autoText=autoCombo?comboDescription(autoCombo):"현재 자동 배차 가능한 조합이 없습니다.";
      const categoryClass=c.category==="장거리"?"category-longhaul":c.category==="해외"?"category-overseas":"";

      return `<article class="contract">
        <div class="contract-top">
          <div><h4>${c.from} → ${c.to}</h4><p>${c.cargo}</p></div>
          <div class="money">${won(Math.round(c.base*businessRevenueMultiplier()))}</div>
        </div>
        <div class="contract-meta">
          <span class="requirement-badge">필요 적재 ${c.requiredStack}스택</span>
          <span class="meta">요구 등급 ${c.minRank}</span>
          <span class="meta">평판 +${c.rep}</span>
          <span class="meta">${c.risk}</span>
          ${c.category!=="일반"?`<span class="employee-badge ${categoryClass}">${c.category} 계약</span>`:""}
          ${state.warehouseOwned?`<span class="meta">창고 +10%</span>`:""}
          ${(state.hqPerks.directIncome||0)>0?`<span class="meta">직접수익 +${state.hqPerks.directIncome*5}%</span>`:""}
        </div>

        <div class="auto-fit-preview">
          <strong>${state.autoFitEnabled ? "자동 맞춤 추천" : "자동 맞춤 사용 가능"}</strong>
          <p>${autoText}</p>
          ${autoCombo ? `<span class="speed-badge ${speedClass(autoCombo.speed)}">${speedLabel(autoCombo.speed)}</span>` : ""}
        </div>

        <div class="manual-contract-area ${state.autoFitEnabled ? "manual-select-hidden" : ""}" data-manual-area="${c.id}">
          <div class="contract-stack-summary">
            <span>수동 선택 적재량</span>
            <strong data-stack-summary="${c.id}">0 / ${c.requiredStack} 스택</strong>
          </div>
          <div class="contract-fleet-select">
            ${options || `<p class="muted">현재 대기 중인 차량이 없습니다.</p>`}
          </div>
        </div>

        <div class="contract-mode-actions">
          ${state.autoFitEnabled
            ? `<button class="${baseDisabled||!autoCombo?"":"primary"}" data-auto-contract="${c.id}" ${baseDisabled||!autoCombo?"disabled":""}>
                 ${disabledReason || (autoCombo ? "자동 맞춤으로 계약 수행" : "자동 배차 불가")}
               </button>`
            : `<button data-fill-auto="${c.id}" ${baseDisabled||!autoCombo?"disabled":""}>자동 맞춤 선택</button>
               <button data-contract="${c.id}" ${baseDisabled?"disabled":""}>${disabledReason || "선택 차량으로 계약 수행"}</button>`
          }
        </div>
      </article>`;
    }).join("");

    $$("[data-contract-vehicle]").forEach(box=>{
      box.addEventListener("change",()=>updateContractSelectionSummary(box.dataset.contractVehicle));
    });

    $$("[data-auto-contract]").forEach(btn=>btn.addEventListener("click",()=>{
      const c=state.contracts.find(x=>x.id===btn.dataset.autoContract);
      if(!c)return;
      const combo=findBestVehicleCombo(c.requiredStack);
      if(!combo){toast("현재 자동 배차 가능한 차량 조합이 없습니다.");return;}
      runContract(c.id,combo.vehicleIds);
    }));

    $$("[data-fill-auto]").forEach(btn=>btn.addEventListener("click",()=>{
      const c=state.contracts.find(x=>x.id===btn.dataset.fillAuto);
      if(!c)return;
      const combo=findBestVehicleCombo(c.requiredStack);
      if(!combo){toast("현재 자동 배차 가능한 차량 조합이 없습니다.");return;}
      $$(`[data-contract-vehicle="${c.id}"]`).forEach(box=>box.checked=combo.vehicleIds.includes(box.value));
      updateContractSelectionSummary(c.id);
      toast(`자동 맞춤 선택 · ${comboDescription(combo)}`);
    }));

    $$("[data-contract]").forEach(btn=>btn.addEventListener("click",()=>{
      const id=btn.dataset.contract;
      const vehicleIds=$$(`[data-contract-vehicle="${id}"]:checked`).map(x=>x.value);
      runContract(id,vehicleIds);
    }));
  }

  function updateContractSelectionSummary(contractId){
    const c=state.contracts.find(x=>x.id===contractId);
    if(!c)return;
    const ids=$$(`[data-contract-vehicle="${contractId}"]:checked`).map(x=>x.value);
    const stack=fleetStack(ids);
    const speed=convoySpeed(ids);
    const summary=$(`[data-stack-summary="${contractId}"]`);
    if(summary){
      summary.textContent=ids.length
        ? `${stack} / ${c.requiredStack} 스택 · 차량 ${ids.length}대 · ${speedLabel(speed)}`
        : `0 / ${c.requiredStack} 스택`;
    }
    const btn=$(`[data-contract="${contractId}"]`);
    if(btn && !btn.dataset.baseDisabled){
      const currentRank=rankFromRep(state.logisticsRep).rank;
      const rankOk=rankIndex(currentRank)>=rankIndex(c.minRank);
      btn.disabled=!(rankOk && stack>=c.requiredStack);
      btn.classList.toggle("primary",!btn.disabled);
      if(rankOk){
        btn.textContent=stack>=c.requiredStack ? "선택 차량으로 계약 수행" : "적재 스택 부족";
      }
    }
  }

  function runContract(contractId,vehicleIds){
    const c=state.contracts.find(x=>x.id===contractId);
    if(!c)return;
    vehicleIds=[...new Set(vehicleIds)].filter(id=>state.fleet.some(v=>v.id===id));

    if(!vehicleIds.length){toast("배차할 차량을 선택하세요.");return;}
    if(vehicleIds.some(isVehicleBusy)){toast("선택한 차량 중 이미 운송 중인 차량이 있습니다.");return;}

    const currentRank=rankFromRep(state.logisticsRep).rank;
    if(rankIndex(currentRank)<rankIndex(c.minRank)){toast("회사 등급이 부족합니다.");return;}

    const stack=fleetStack(vehicleIds);
    if(stack<c.requiredStack){
      toast(`적재량이 부족합니다. ${stack}/${c.requiredStack} 스택`);
      return;
    }

    const speed=convoySpeed(vehicleIds);
    const revenueBase=Math.round(c.base*businessRevenueMultiplier());
    const eventRoll=Math.random();
    let eventText="정상 운송 완료";
    let finalReward=revenueBase;
    if(eventRoll>.90){
      finalReward=Math.round(revenueBase*FAST_DELIVERY_BONUS_MULTIPLIER);
      eventText="빠른 배송 · 보너스 10%";
    }

    const baseSeconds=6+Math.ceil(c.requiredStack*.55);
    const durationMs=Math.round((baseSeconds/speed+Math.random()*4)*DELIVERY_DURATION_MULTIPLIER*1000);
    const startedAt=Date.now();

    state.activeDeliveries.push({
      id:crypto.randomUUID(),
      contractId:c.id,
      vehicleIds,
      usedStack:stack,
      speed,
      startedAt,
      endAt:startedAt+durationMs,
      durationMs,
      finalReward,
      eventText,
      driverId:null,
      autoManaged:false,
      snapshot:{...c}
    });

    state.contracts=state.contracts.filter(x=>x.id!==c.id);
    save();
    render();

    const convoy=vehicleIds.map(id=>{
      const v=state.fleet.find(x=>x.id===id);
      return v?vehicleDef(v.type).label:"?";
    }).join(" + ");
    toast(`${convoy} 직접 배차 · ${c.from} → ${c.to}`);
  }

  async function finishDelivery(deliveryId){
    if(deliverySettling.has(deliveryId))return;
    const d=state.activeDeliveries.find(x=>x.id===deliveryId);
    if(!d)return;
    deliverySettling.add(deliveryId);
    const c=d.snapshot||{};
    try{
      await applyWalletEvent("direct_contract_reward",`contract-${d.id}`,d.finalReward,{
        contract_id:d.contractId,
        from:c.from||"",
        to:c.to||"",
        cargo:c.cargo||"",
        required_stack:c.requiredStack||0,
        vehicles:(d.vehicleIds||[]).length,
        event:d.eventText
      });

      state.activeDeliveries=state.activeDeliveries.filter(x=>x.id!==deliveryId);
      state.logisticsRevenue+=d.finalReward;
      state.logisticsRep+=(c.rep||0);
      state.completedContracts++;
      if((c.requiredStack||0)>=12)state.xlargeCompleted++;

      if(state.contracts.length<2)generateContracts();
      ensureHeadquartersUnlock();
      save();render();
      toast(`운송 완료 · ${d.eventText} · +${won(d.finalReward)}`);
    }catch(error){
      setOnlineStatus(error?.message||"운송 보상 정산 실패","error");
      toast(error?.message||"운송 보상 정산 실패");
    }finally{
      deliverySettling.delete(deliveryId);
    }
  }

  function tickActiveDeliveries(){
    if(!state.activeDeliveries.length)return;
    const finished=[];
    for(const d of state.activeDeliveries){
      const p=activeDeliveryProgress(d);
      if(p.remain<=0){
        finished.push(d.id);
        continue;
      }
      const remain=$(`[data-dock-remain="${d.id}"]`);
      const bar=$(`[data-dock-bar="${d.id}"]`);
      if(remain)remain.textContent=`${p.seconds}초`;
      if(bar)bar.style.width=`${p.pct}%`;
    }
    finished.forEach(id=>void finishDelivery(id));
  }
  setInterval(tickActiveDeliveries,250);

  async function buyVehicle(type){
    const def=vehicleDef(type);
    const limit=fleetLimit();
    if(state.fleet.length>=limit){toast(`현재 차량은 최대 ${limit}대까지 소유할 수 있습니다.`);return;}
    if(state.balance<def.cost){toast("가상잔액이 부족합니다.");return;}

    const vehicleId=uuid();
    const sameTypeCount=state.fleet.filter(v=>v.type===type).length+1;
    try{
      await applyWalletEvent(vehicleEventKey("vehicle_buy",type),`vehicle-${vehicleId}`,-def.cost,{
        vehicle_id:vehicleId,vehicle_type:type
      });
      state.fleet.push({
        id:vehicleId,
        type:def.key,
        name:`${def.name} ${sameTypeCount}호`,
        purchaseCost:def.cost,
        starter:false,
        acquiredAt:Date.now()
      });
      save();render();
      toast(`${def.name} 구매 완료`);
    }catch(error){
      setOnlineStatus(error?.message||"차량 구매 실패","error");
      toast(error?.message||"차량 구매 실패");
    }
  }

  async function sellVehicle(vehicleId){
    const vehicle=state.fleet.find(v=>v.id===vehicleId);
    if(!vehicle)return;
    if(vehicle.starter){toast("스타터 차량은 판매 대신 크기 업그레이드를 사용할 수 있습니다.");return;}
    if(isVehicleBusy(vehicle.id)){toast("운송 중인 차량은 판매할 수 없습니다.");return;}

    const sale=Math.floor((vehicle.purchaseCost||vehicleDef(vehicle.type).cost)*.5);
    if(!confirm(`${vehicleLabel(vehicle)}을(를) ${won(sale)}에 판매할까요?\n판매금은 공용 SD지갑으로 들어갑니다.`))return;

    try{
      await applyWalletEvent(vehicleEventKey("vehicle_sale",vehicle.type),`vehicle-${vehicle.id}-sale`,sale,{
        vehicle_id:vehicle.id,vehicle_type:vehicle.type
      });
      state.fleet=state.fleet.filter(v=>v.id!==vehicleId);
      save();render();
      toast(`차량 판매 완료 · +${won(sale)}`);
    }catch(error){
      setOnlineStatus(error?.message||"차량 판매 실패","error");
      toast(error?.message||"차량 판매 실패");
    }
  }

  function starterUpgradeInfo(vehicle){
    if(!vehicle.starter)return null;
    const current=vehicleDef(vehicle.type);
    const next=vehicleTypes[current.order+1];
    if(!next)return null;
    const cost=Math.max(0,next.cost-current.cost);
    return {current,next,cost};
  }

  async function upgradeStarterVehicle(vehicleId){
    const vehicle=state.fleet.find(v=>v.id===vehicleId);
    if(!vehicle||!vehicle.starter)return;
    if(isVehicleBusy(vehicle.id)){toast("운송 중에는 스타터 차량을 업그레이드할 수 없습니다.");return;}

    const info=starterUpgradeInfo(vehicle);
    if(!info){toast("스타터 차량이 이미 초대형입니다.");return;}
    if(state.balance<info.cost){toast("업그레이드 비용이 부족합니다.");return;}

    try{
      await applyWalletEvent(
        starterUpgradeEventKey(info.current.key,info.next.key),
        `starter-upgrade-${info.next.key}`,
        -info.cost,
        {from_type:info.current.key,to_type:info.next.key}
      );
      vehicle.type=info.next.key;
      vehicle.name=`SD 스타터 ${info.next.name}`;
      save();render();
      toast(`스타터 차량 ${info.next.label} 업그레이드 완료`);
    }catch(error){
      setOnlineStatus(error?.message||"스타터 차량 업그레이드 실패","error");
      toast(error?.message||"스타터 차량 업그레이드 실패");
    }
  }

  function renderFleet(){
    const host=$("#fleetList");
    if(!host)return;

    host.innerHTML=state.fleet.map(v=>{
      const def=vehicleDef(v.type);
      const busy=isVehicleBusy(v.id);
      const delivery=activeDeliveryByVehicle(v.id);
      const sale=Math.floor((v.purchaseCost||def.cost)*.5);
      const contract=delivery?.snapshot;
      const upgrade=starterUpgradeInfo(v);

      let action="";
      if(v.starter){
        if(upgrade){
          action=`<div class="starter-upgrade-box">
            <button class="${busy||state.balance<upgrade.cost?"":"primary"}" data-upgrade-starter="${v.id}" ${busy||state.balance<upgrade.cost?"disabled":""}>
              ${busy ? "운송 중 · 업그레이드 불가" : `스타터 ${upgrade.next.label} 업그레이드 · ${won(upgrade.cost)}`}
            </button>
          </div>`;
        }else{
          action=`<div class="starter-upgrade-box"><button disabled>스타터 차량 최고 크기</button></div>`;
        }
      }else{
        action=`<button data-sell-vehicle="${v.id}" ${busy?"disabled":""}>
          ${busy ? "운송 중 · 판매 불가" : `판매 · ${won(sale)}`}
        </button>`;
      }

      return `<article class="vehicle-card ${busy?"busy":""}">
        <div class="vehicle-card-head">
          <div>
            <h4>${v.name||def.name}</h4>
            <p>${def.desc}</p>
          </div>
          <span class="vehicle-type">${def.label}</span>
        </div>
        <div class="vehicle-capacity">
          <span class="meta">적재 ${def.stack}스택</span>
          <span class="speed-badge ${speedClass(def.speed)}">${speedLabel(def.speed)}</span>
        </div>
        <div class="vehicle-status">
          <span>${busy ? `🚚 운송 중${contract?.to ? ` · ${contract.to}` : ""}` : "✓ 대기 중"}</span>
          <span>${v.starter ? "스타터 차량" : `판매 ${won(sale)}`}</span>
        </div>
        ${action}
      </article>`;
    }).join("");

    $$("[data-sell-vehicle]").forEach(b=>b.onclick=()=>sellVehicle(b.dataset.sellVehicle));
    $$("[data-upgrade-starter]").forEach(b=>b.onclick=()=>upgradeStarterVehicle(b.dataset.upgradeStarter));
  }

  function renderVehicleShop(){
    const host=$("#vehicleShop");
    if(!host)return;
    const limit=fleetLimit();
    const full=state.fleet.length>=limit;

    host.innerHTML=`
      <div class="stack-legend">
        ${vehicleTypes.map(def=>`<span class="stack-chip">${def.label} ${def.stack}스택 · <span class="speed-badge ${speedClass(def.speed)}">${speedLabel(def.speed)}</span></span>`).join("")}
      </div>
      <div class="speed-legend">
        <span class="speed-badge speed-very-fast">매우 빠름</span>
        <span class="speed-badge speed-fast">빠름</span>
        <span class="speed-badge speed-normal">보통</span>
        <span class="speed-badge speed-slow">느림</span>
      </div>
      ${vehicleTypes.map(def=>{
        const disabled=full||state.balance<def.cost;
        let label=`구매 · ${won(def.cost)}`;
        if(full)label=`차량 슬롯 가득 참 (${limit}대)`;
        else if(state.balance<def.cost)label=`잔액 부족 · ${won(def.cost)}`;

        return `<article class="shop-vehicle">
          <div class="shop-vehicle-top">
            <div>
              <h4>${def.label} · ${def.name}</h4>
              <small>${def.desc}</small>
            </div>
            <strong>${won(def.cost)}</strong>
          </div>
          <button class="${disabled?"":"primary"}" data-buy-vehicle="${def.key}" ${disabled?"disabled":""}>${label}</button>
        </article>`;
      }).join("")}
    `;

    $$("[data-buy-vehicle]").forEach(b=>b.onclick=()=>buyVehicle(b.dataset.buyVehicle));
  }

  function renderCompanyFleetSummary(){
    const slot=$("#fleetSlotText");
    const active=$("#activeDeliveryCount");
    const badge=$("#fleetCountBadge");
    const limit=fleetLimit();
    if(slot)slot.textContent=`${state.fleet.length} / ${limit}`;
    if(active)active.textContent=`${state.activeDeliveries.length}건`;
    if(badge)badge.textContent=`${state.fleet.length} / ${limit}`;
    const label=$("#fleetLimitLabel");
    if(label)label.textContent=`최대 ${limit}대 · 구매 / 판매 / 배차`;

    const fleetSummary=$("#fleetSummaryMeta");
    if(fleetSummary)fleetSummary.textContent=`${state.fleet.length}대 보유 · ${state.activeDeliveries.length}건 운송 중`;

    const contractsSummary=$("#contractsSummaryMeta");
    if(contractsSummary)contractsSummary.textContent=`대기 ${state.contracts.length}건 · 운송 중 ${state.activeDeliveries.length}건`;
  }

  function syncLogisticsCollapseState(){
    const contractsMenu=$("#contractsMenu");
    const fleetMenu=$("#fleetMenu");
    if(contractsMenu)contractsMenu.open=state.logisticsUiOpen?.contracts !== false;
    if(fleetMenu)fleetMenu.open=state.logisticsUiOpen?.fleet !== false;
  }

  function bindLogisticsCollapseState(){
    const contractsMenu=$("#contractsMenu");
    const fleetMenu=$("#fleetMenu");

    if(contractsMenu && !contractsMenu.dataset.bound){
      contractsMenu.dataset.bound="1";
      contractsMenu.addEventListener("toggle",()=>{
        if(!state.logisticsUiOpen)state.logisticsUiOpen={};
        state.logisticsUiOpen.contracts=contractsMenu.open;
        save();
      });
    }

    if(fleetMenu && !fleetMenu.dataset.bound){
      fleetMenu.dataset.bound="1";
      fleetMenu.addEventListener("toggle",()=>{
        if(!state.logisticsUiOpen)state.logisticsUiOpen={};
        state.logisticsUiOpen.fleet=fleetMenu.open;
        save();
      });
    }
  }

  function hqSectionIsOpen(key){
    return !!state.hqUiOpen?.[key];
  }

  function hqSectionOpenAttr(key){
    return hqSectionIsOpen(key) ? " open" : "";
  }

  function bindHqCollapseState(){
    $$("[data-hq-section]").forEach(details=>{
      details.addEventListener("toggle",()=>{
        if(!state.hqUiOpen)state.hqUiOpen={};
        state.hqUiOpen[details.dataset.hqSection]=details.open;
        save();
      });
    });
  }

  function renderHeadquarters(){
    const host=$("#headquartersPanel");
    if(!host)return;

    const rank=rankFromRep(state.logisticsRep).rank;
    if(rank!=="S" && state.headquartersLevel<1){
      host.innerHTML=`<div class="hq-locked">
        <div>
          <div class="hq-lock-icon">🔒</div>
          <h3>S등급에서 물류 본부 해금</h3>
          <p>F~S 회사를 성장시키면 물류 본부 Lv.1이 열립니다. Lv.2부터 기사 자동수익 시스템을 시작할 수 있습니다.</p>
        </div>
      </div>`;
      return;
    }

    ensureHeadquartersUnlock();
    const level=state.headquartersLevel;
    const next=level<10?level+1:null;
    const req=next?headquartersLevels[next]:null;
    const currentTitle=level>=10?"대형 물류기업":level>=8?"국제 물류 본부":level>=5?"광역 물류 본부":"지역 물류 본부";

    const reqHtml=req?`
      <div class="hq-next">
        <div class="hq-next-head">
          <div>
            <strong>본부 Lv.${next} 승급</strong>
            <p class="muted">${req.unlock} 해금 · 특성 포인트 +1</p>
          </div>
          <span class="tiny-badge">승급비 ${won(req.fee)}</span>
        </div>
        <div class="hq-requirements">
          <div class="hq-req ${state.completedContracts>=req.contracts?"ok":""}"><span>누적 직접 배송</span><strong>${state.completedContracts} / ${req.contracts}</strong></div>
          <div class="hq-req ${state.xlargeCompleted>=req.xlarge?"ok":""}"><span>12스택+ 직접 배송</span><strong>${state.xlargeCompleted} / ${req.xlarge}</strong></div>
          <div class="hq-req ${state.logisticsRevenue>=req.revenue?"ok":""}"><span>누적 물류 수익</span><strong>${won(state.logisticsRevenue)} / ${won(req.revenue)}</strong></div>
          <div class="hq-req ${state.fleet.length>=req.fleet?"ok":""}"><span>보유 차량</span><strong>${state.fleet.length} / ${req.fleet}</strong></div>
        </div>
        <button class="${hqRequirementsMet(next)?"primary":""}" id="hqUpgradeBtn" ${hqRequirementsMet(next)?"":"disabled"}>
          ${hqRequirementsMet(next)?`Lv.${next}로 승급`:"승급 조건 미달"}
        </button>
      </div>`:
      `<div class="hq-next"><strong>본부 Lv.10 · 최종 단계 달성</strong><p class="muted">기사 정원 10명과 대형 물류기업 수익 보너스가 적용됩니다.</p></div>`;

    const roadmap=headquartersUnlocks.map(x=>`
      <div class="hq-roadmap-item ${x.level<level?"done":x.level===level?"active":""}">
        <strong>Lv.${x.level}</strong><small>${x.text}</small>
      </div>`).join("");

    const spentPerks=(state.hqPerks.driverIncome||0)+(state.hqPerks.directIncome||0)+(state.hqPerks.driverSpeed||0);

    const perkPanel=level>=2?`
      <div class="hq-perk-panel">
        <div class="hq-perk-head">
          <div>
            <h4>본부 레벨업 특성</h4>
            <p>본부 레벨업 때 받은 포인트를 원하는 옵션에 배분합니다. 기사 수익만 집중해서 올리는 것도 가능합니다.</p>
          </div>
          <span class="tiny-badge">남은 포인트 ${state.hqPerkPoints}</span>
        </div>
        <div class="hq-perk-grid">
          <div class="hq-perk-option">
            <strong>기사 수익 강화</strong>
            <small>1포인트당 기사 전용 임무 수익 +10%</small>
            <button class="${state.hqPerkPoints>0?"primary":""}" data-hq-perk="driverIncome" ${state.hqPerkPoints<=0?"disabled":""}>+10% 선택</button>
          </div>
          <div class="hq-perk-option">
            <strong>직접 배송 수익 강화</strong>
            <small>1포인트당 유저 직접 계약 수익 +5%</small>
            <button class="${state.hqPerkPoints>0?"primary":""}" data-hq-perk="directIncome" ${state.hqPerkPoints<=0?"disabled":""}>+5% 선택</button>
          </div>
          <div class="hq-perk-option">
            <strong>기사 임무 속도 강화</strong>
            <small>1포인트당 기사 임무시간 -8% · 최대 -45%</small>
            <button class="${state.hqPerkPoints>0?"primary":""}" data-hq-perk="driverSpeed" ${state.hqPerkPoints<=0?"disabled":""}>-8% 선택</button>
          </div>
        </div>
        <div class="hq-perk-stats">
          <span class="meta">기사 수익 +${(state.hqPerks.driverIncome||0)*10}%</span>
          <span class="meta">직접 배송 +${(state.hqPerks.directIncome||0)*5}%</span>
          <span class="meta">기사 임무시간 -${Math.min(45,(state.hqPerks.driverSpeed||0)*8)}%</span>
        </div>
        <div class="hq-reset-row">
          <p>사용한 특성 포인트를 전부 돌려받고 다시 배분할 수 있습니다.</p>
          <button id="resetHqPerksBtn" ${spentPerks<=0?"disabled":""}>특성 초기화 · ${spentPerks}P 반환</button>
        </div>
      </div>`:"";

    let driverSystem="";
    if(level>=2){
      const missions=availableDriverMissions();
      const catalog=missions.map(m=>`
        <div class="driver-mission-info">
          <div><strong>${m.name}</strong><small>${m.desc} · 현재 ${driverMissionDuration(m)}초</small></div>
          <span>${won(driverMissionPayout(m))}</span>
        </div>`).join("");

      const drivers=state.employees.map(d=>{
        const selected=d.missionId&&missions.some(m=>m.id===d.missionId)?d.missionId:(missions[0]?.id||"");
        const mission=driverMissions.find(m=>m.id===selected);
        const duration=mission?driverMissionDuration(mission):0;
        const payout=mission?driverMissionPayout(mission):0;
        const remain=d.active&&d.nextPayoutAt?Math.max(0,d.nextPayoutAt-Date.now()):0;
        const pct=d.active&&duration?clamp((1-remain/(duration*1000))*100,0,100):0;

        return `<article class="driver-card ${d.active?"busy":""}">
          <div class="driver-top">
            <div>
              <h5>${d.name}</h5>
              <small>${d.active?"● 기사 전용 임무 자동수익 중":"○ 대기 중"}</small>
            </div>
            <span class="tiny-badge">누적 ${won(d.totalEarned||0)}</span>
          </div>

          <div class="driver-mission-select">
            <select data-driver-mission-select="${d.id}" ${d.active?"disabled":""}>
              ${missions.map(m=>`<option value="${m.id}" ${m.id===selected?"selected":""}>${m.name}</option>`).join("")}
            </select>
          </div>

          ${mission?`<div class="driver-income-line">
            <span>${driverMissionDuration(mission)}초마다 자동 정산</span>
            <b>+${won(payout)}</b>
          </div>`:""}

          ${d.active&&mission?`
            <div class="driver-mission-progress">
              <div class="driver-mission-progress-head">
                <strong>${mission.name}</strong>
                <span data-driver-remain="${d.id}">${Math.ceil(remain/1000)}초</span>
              </div>
              <div class="progress"><div data-driver-bar="${d.id}" style="width:${pct}%"></div></div>
            </div>`:""}

          <div class="driver-actions">
            ${d.active
              ? `<button data-stop-driver="${d.id}">근무 중지</button>`
              : `<button class="primary" data-start-driver="${d.id}" ${missions.length?"":"disabled"}>자동수익 시작</button>`}
            <button data-fire-driver="${d.id}" ${d.active?"disabled":""}>기사 해고</button>
          </div>
        </article>`;
      }).join("");

      driverSystem=`<section class="hq-system">
        <h4>기사 자동수익</h4>
        <p>기사는 유저 계약과 보유 차량을 쓰지 않습니다. 기사 전용 임무에 배정하면 해당 임무를 반복해 자동으로 수익을 만듭니다.</p>
        <div class="driver-list">${drivers||`<p class="muted">기사를 채용한 뒤 전용 임무에 배정하세요.</p>`}</div>
        <div class="driver-controls">
          <button class="${state.employees.length<driverLimit()&&state.balance>=300000?"primary":""}" id="hireDriverBtn" ${state.employees.length>=driverLimit()||state.balance<300000?"disabled":""}>
            기사 채용 · 300,000원 (${state.employees.length}/${driverLimit()})
          </button>
        </div>
        <div class="driver-mission-catalog">${catalog}</div>
      </section>`;
    }

    let warehouseSystem="";
    if(level>=6){
      warehouseSystem=`<section class="hq-system">
        <h4>물류창고</h4>
        <p>물류창고를 가동하면 직접 배송과 기사 전용 임무의 기본 수익이 10% 증가합니다.</p>
        <div class="hq-warehouse">
          <strong>${state.warehouseOwned?"✅ 물류창고 가동 중":"🏭 물류창고 미보유"}</strong>
          <span class="muted">${state.warehouseOwned?"전체 물류 기본 수익 +10%":"구매가 3,000,000원"}</span>
          <button class="${!state.warehouseOwned&&state.balance>=3000000?"primary":""}" id="buyWarehouseBtn" ${state.warehouseOwned||state.balance<3000000?"disabled":""}>
            ${state.warehouseOwned?"구매 완료":"물류창고 구매"}
          </button>
        </div>
      </section>`;
    }

    const driverRunning=state.employees.filter(d=>d.active).length;

    host.innerHTML=`
      <div class="hq-top">
        <div class="hq-level">
          <div class="hq-level-number">Lv.${level}</div>
          <div><strong>${currentTitle}</strong><div class="hq-title">S등급 이후 물류회사 장기 성장</div></div>
        </div>
        <span class="badge">${level>=10?"ENDGAME COMPLETE":`다음 해금: ${req?.unlock||"완료"}`}</span>
      </div>

      <div class="hq-metrics">
        <div class="hq-metric"><span>누적 직접 배송</span><strong>${state.completedContracts}건</strong><small>유저 계약 진행</small></div>
        <div class="hq-metric"><span>기사 누적 수익</span><strong>${won(state.driverRevenue)}</strong><small>기사 전용 임무</small></div>
        <div class="hq-metric"><span>누적 물류 수익</span><strong>${won(state.logisticsRevenue)}</strong><small>직접 + 기사 합산</small></div>
        <div class="hq-metric"><span>직원 기사</span><strong>${state.employees.length} / ${driverLimit()}</strong><small>${driverRunning}명 근무 중</small></div>
      </div>

      <details class="hq-collapsible"${hqSectionOpenAttr("upgrade")} data-hq-section="upgrade">
        <summary>
          <span>본부 승급</span>
          <span class="hq-summary-note">${next?`다음 Lv.${next}`:"최종 단계"}</span>
        </summary>
        <div class="hq-collapsible-body">${reqHtml}</div>
      </details>

      ${level>=2?`
        <details class="hq-collapsible"${hqSectionOpenAttr("perks")} data-hq-section="perks">
          <summary>
            <span>본부 특성</span>
            <span class="hq-summary-note">남은 ${state.hqPerkPoints}P</span>
          </summary>
          <div class="hq-collapsible-body">${perkPanel}</div>
        </details>`:""}

      <details class="hq-collapsible"${hqSectionOpenAttr("roadmap")} data-hq-section="roadmap">
        <summary>
          <span>본부 레벨 로드맵</span>
          <span class="hq-summary-note">Lv.${level} / 10</span>
        </summary>
        <div class="hq-collapsible-body"><div class="hq-roadmap">${roadmap}</div></div>
      </details>

      ${driverSystem?`
        <details class="hq-collapsible"${hqSectionOpenAttr("drivers")} data-hq-section="drivers">
          <summary>
            <span>기사 자동수익</span>
            <span class="hq-summary-note">${driverRunning}명 근무 중</span>
          </summary>
          <div class="hq-collapsible-body">${driverSystem}</div>
        </details>`:""}

      ${warehouseSystem?`
        <details class="hq-collapsible"${hqSectionOpenAttr("warehouse")} data-hq-section="warehouse">
          <summary>
            <span>물류창고</span>
            <span class="hq-summary-note">${state.warehouseOwned?"가동 중":"미보유"}</span>
          </summary>
          <div class="hq-collapsible-body">${warehouseSystem}</div>
        </details>`:""}
    `;

    const up=$("#hqUpgradeBtn");
    if(up)up.onclick=upgradeHeadquarters;

    $$("[data-hq-perk]").forEach(b=>b.onclick=()=>chooseHqPerk(b.dataset.hqPerk));

    const reset=$("#resetHqPerksBtn");
    if(reset)reset.onclick=resetHqPerks;

    const hire=$("#hireDriverBtn");
    if(hire)hire.onclick=hireDriver;

    $$("[data-start-driver]").forEach(b=>b.onclick=()=>{
      const id=b.dataset.startDriver;
      const select=$(`[data-driver-mission-select="${id}"]`);
      startDriverMission(id,select?.value);
    });
    $$("[data-stop-driver]").forEach(b=>b.onclick=()=>stopDriverMission(b.dataset.stopDriver));
    $$("[data-fire-driver]").forEach(b=>b.onclick=()=>fireDriver(b.dataset.fireDriver));

    const wh=$("#buyWarehouseBtn");
    if(wh)wh.onclick=buyWarehouse;

    bindHqCollapseState();
  }

  function render(){
    ensureHeadquartersUnlock();
    ensureContracts();

    const rank=rankFromRep(state.logisticsRep);
    $("#walletBalance").textContent=won(state.balance);
    $("#logisticsRank").textContent=rank.rank;
    $("#logisticsRepText").textContent=rank.next
      ? `${state.logisticsRep} / ${rank.next}`
      : `${state.logisticsRep} · 본부 Lv.${Math.max(1,state.headquartersLevel)}`;
    $("#companyRank").textContent=rank.rank;
    $("#companyRep").textContent=state.logisticsRep;
    $("#completedContracts").textContent=state.completedContracts+"건";

    let pct=100;
    if(rank.next) pct=clamp((state.logisticsRep-rank.min)/(rank.next-rank.min)*100,0,100);
    $("#rankProgressBar").style.width=pct+"%";
    $("#rankProgressText").textContent=Math.round(pct)+"%";



    const autoToggle=$("#autoFitToggle");
    if(autoToggle)autoToggle.checked=state.autoFitEnabled;

    syncLogisticsCollapseState();
    bindLogisticsCollapseState();

    renderCompanyFleetSummary();
    renderActiveDeliveryDock();
    renderContracts();renderFleet();renderVehicleShop();renderHeadquarters();
  }

  function openModal(html){
    if(modalCleanup){try{modalCleanup();}catch(_){} modalCleanup=null;}
    $("#modalBody").innerHTML=html;
    $("#modal").classList.remove("hidden");
    $("#modal").setAttribute("aria-hidden","false");
  }
  function closeModal(){
    if(modalCleanup){try{modalCleanup();}catch(_){} modalCleanup=null;}
    $("#modal").classList.add("hidden");
    $("#modal").setAttribute("aria-hidden","true");
  }
  $("#modalClose").onclick=closeModal;


  $("#autoFitToggle").onchange=(e)=>{
    state.autoFitEnabled=!!e.target.checked;
    save();
    renderContracts();
    toast(state.autoFitEnabled ? "자동 맞춤 배차 ON" : "수동 배차 모드");
  };

  $("#refreshContractsBtn").onclick=()=>{
    generateContracts();
    render();
    toast(state.activeDeliveries.length
      ? "배송은 계속 진행되고 새 계약 목록만 갱신되었습니다."
      : "새 계약이 도착했습니다.");
  };


  $("#resetBtn").onclick=()=>{
    if(confirm("물류센터 진행도만 초기화할까요?\n공용 SD지갑 잔액과 거래 내역은 초기화되지 않습니다.")){
      if(modalCleanup){try{modalCleanup();}catch(_){} modalCleanup=null;}
      localStorage.removeItem(KEY);
      const walletBalance=state.balance;
      state=structuredClone(baseState);
      state.balance=walletBalance;
      generateContracts();save();render();
      void refreshServerLedger();
      toast("물류 진행도 초기화 완료 · SD지갑은 유지됨");
    }
  };

  async function initializeOnlineLogistics(){
    document.body.classList.add("online-loading");
    try{
      onlineAuth=window.SD_AUTH;
      if(!onlineAuth)throw new Error("SD 온라인 인증 모듈을 불러오지 못했습니다.");

      onlineSession=await onlineAuth.requireSession();
      if(!onlineSession)return;

      const [profileResult,walletResult,progressResult]=await Promise.all([
        onlineAuth.client.from("profiles").select("nickname,status,role").single(),
        onlineAuth.client.from("wallets").select("id,account_number,balance,updated_at").single(),
        onlineAuth.client.from("sd_logistics_progress").select("state,updated_at").maybeSingle()
      ]);
      if(profileResult.error)throw profileResult.error;
      if(walletResult.error)throw walletResult.error;
      if(progressResult.error)throw progressResult.error;
      if(profileResult.data.status!=="active")throw new Error("현재 이용할 수 없는 계정입니다.");

      onlineProfile=profileResult.data;
      onlineWallet=walletResult.data;

      // 서버 진행도가 있으면 우선 사용. 없으면 기존 브라우저 물류 확장팩 진행도를 마이그레이션.
      if(progressResult.data?.state && typeof progressResult.data.state==="object"){
        const serverProgress=progressResult.data.state;
        const migratedLocal=state;
        state={...migratedLocal,...serverProgress};
      }

      state.balance=Number(onlineWallet.balance||0);
      serverReady=true;
      save();

      const identity=$("#onlineIdentity");
      if(identity)identity.textContent=`${onlineProfile.nickname}님 · 홈페이지 계정 연동`;
      if($("#walletAccountNumber"))$("#walletAccountNumber").textContent=`SD 가상계좌 ${onlineWallet.account_number}`;

      ensureContracts();
      render();
      await refreshServerLedger();
      setOnlineStatus("공용 SD지갑과 동기화됨","success");
    }catch(error){
      console.error(error);
      setOnlineStatus(onlineAuth?.messageForError?.(error)||error?.message||"서버 연결 실패","error");
      const balance=$("#walletBalance");
      if(balance)balance.textContent="연결 실패";
    }finally{
      document.body.classList.remove("online-loading");
    }
  }

  $("#walletRefreshBtn")?.addEventListener("click",async()=>{
    try{
      setOnlineStatus("SD지갑 새로고침 중…","busy");
      await refreshOnlineWallet({renderAfter:true,ledger:true});
      setOnlineStatus("공용 SD지갑과 동기화됨","success");
    }catch(error){
      setOnlineStatus(onlineAuth?.messageForError?.(error)||error?.message||"지갑 새로고침 실패","error");
    }
  });

  // 다른 SD 앱에서 잔액이 바뀐 경우 웹 물류센터도 주기적으로 갱신.
  setInterval(()=>{
    if(document.visibilityState==="visible" && serverReady){
      void refreshOnlineWallet({renderAfter:true,ledger:false}).catch(()=>{});
    }
  },10000);

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && serverReady){
      void refreshOnlineWallet({renderAfter:true,ledger:true}).catch(()=>{});
    }
  });

  void initializeOnlineLogistics();
})();
