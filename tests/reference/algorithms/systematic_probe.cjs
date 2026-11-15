'use strict';
// Transparent probe-selection heuristic after AA, AB, ..., AJ.
// Uses exact matching for logical deductions, approximate probabilities for scoring.
const fs = require('node:fs');
const {Model,State} = require('./pvz_solver.cjs');

function matching(domains, required, m, force = null, excluded = -1) {
  const n = domains.length;
  if(required.size > n || required.has(excluded)) return null;
  const atSlot=Array(n).fill(-1), atValue=Array(m).fill(-1);
  const allowed=(i,v)=>v!==excluded && (!force || (i===force[0] ? v===force[1] : v!==force[1])) && domains[i].includes(v);
  function assignRequired(v,seen) {
    for(let i=0;i<n;i++) if(!seen[i]&&allowed(i,v)) {
      seen[i]=true;
      if(atSlot[i]<0||assignRequired(atSlot[i],seen)) {
        atSlot[i]=v;atValue[v]=i;return true;
      }
    }
    return false;
  }
  for(const v of required) if(!assignRequired(v,Array(n).fill(false)))return null;
  function fill(i,seen) {
    for(const v of domains[i]) if(!seen[v]&&allowed(i,v)) {
      seen[v]=true;
      if(atValue[v]<0||fill(atValue[v],seen)) {
        atValue[v]=i;atSlot[i]=v;return true;
      }
    }
    return false;
  }
  for(let i=0;i<n;i++)if(atSlot[i]<0&&!fill(i,Array(m).fill(false)))return null;
  return atSlot;
}

function propagate(state) {
  const m=state.model.m, domains=state.domains.map(d=>[...d].sort((a,b)=>a-b));
  if(!matching(domains,state.required,m))throw Error('Inconsistent history');
  // An edge survives iff it participates in at least one complete valid assignment.
  for(let i=0;i<domains.length;i++) {
    domains[i]=domains[i].filter(v=>matching(domains,state.required,m,[i,v])!==null);
  }
  const union=new Set(domains.flat());
  // A value is mandatory iff forbidding it makes every complete assignment impossible.
  for(const v of union)if(!state.required.has(v)&&!matching(domains,state.required,m,null,v))state.required.add(v);
  state.domains=domains.map(d=>new Set(d));
  const absent=new Set([...Array(m).keys()].filter(v=>!union.has(v)));
  const unknown=new Set([...union].filter(v=>!state.required.has(v)));
  const inclusionEstimate=Array(m).fill(0);
  for(const q of union)inclusionEstimate[q]=state.required.has(q)?1:
    Math.max((state.model.n-state.required.size)/unknown.size,
      ...domains.map(d=>d.includes(q)?1/d.length:0));
  return {domains,absent,present:new Set(state.required),unknown,inclusionEstimate};
}

const entropy=probs=>probs.reduce((sum,p)=>p>0?sum-p*Math.log2(p):sum,0);
function approximateOutcomes(model,domain,q,info) {
  const d=domain.length, hit=domain.includes(q)?1:0;
  if(d===1&&hit)return [1,0,0,0]; // G,B,P,X
  let shared=0;
  for(const v of domain)if(v!==q&&model.overlap[q][v])shared++;
  const pG=hit/d;
  const pIn=info.inclusionEstimate[q];
  const share=shared/(d-hit);
  return [pG,pIn-pG,(1-pIn)*share,(1-pIn)*(1-share)];
}

function advise(state,mode='adaptive') {
  const model=state.model,info=propagate(state);
  if(info.domains.every(d=>d.length===1))return {query:info.domains.map(d=>d[0]),info,reason:'unique full solution'};
  if(mode==='lex')return {query:info.domains.map(d=>d[0]),info,reason:'lexicographically first candidate per slot'};
  const query=Array(model.n).fill(-1),details=Array(model.n).fill(null),usedUnknown=new Set();
  // Uncertain positions first. Determined but unlocked positions may test global membership.
  const order=[...Array(model.n).keys()].sort((a,b)=>info.domains[b].length-info.domains[a].length||a-b);
  for(const i of order) {
    if(state.locked.has(i)){query[i]=state.locked.get(i);continue;}
    const domain=info.domains[i];
    let best=null;
    let choices=mode==='candidate'?domain:[...Array(model.m).keys()];
    if(mode==='safe_first') {
      const safe=[...info.absent].filter(q=>{
        const yes=domain.filter(v=>model.overlap[q][v]).length;
        return yes>0&&yes<domain.length;
      });
      choices=safe.length?safe:domain;
    }
    for(const q of choices) {
      const probs=approximateOutcomes(model,domain,q,info);
      let gain=entropy(probs);
      const pIn=probs[0]+probs[1];
      // Membership is revealed once per distinct recipe, not independently per slot.
      if(mode!=='no_dedup'&&usedUnknown.has(q))gain-=entropy([pIn,1-pIn]);
      const status=info.absent.has(q)?'absent':info.present.has(q)?'present':'unknown';
      const candidate={q,gain,pG:probs[0],probs,status};
      if(!best||gain>best.gain+1e-10||Math.abs(gain-best.gain)<1e-10&&
        (candidate.pG>best.pG+1e-10||Math.abs(candidate.pG-best.pG)<1e-10&&q<best.q))best=candidate;
    }
    query[i]=best.q;details[i]=best;
    if(best.status==='unknown')usedUnknown.add(best.q);
  }
  return {query,info,details};
}

function starOpening(model) {
  const row=model.pairs.map((p,i)=>p[0]===0?i:-1).filter(v=>v>=0);
  if(row.length!==model.n)throw Error('This opening requires one slot for every A-based legal recipe');
  return row;
}

function play(secret,model=new Model(),mode='adaptive') {
  const state=new State(model),trace=[];
  let query=starOpening(model);
  while(!state.done) {
    const response=model.feedback(secret,query);
    trace.push({round:trace.length+1,query:model.decode(query),response});
    state.update(query,response);
    if(!state.done)query=advise(state,mode).query;
    if(trace.length>model.n*model.m+model.m+model.n+2)throw Error('Unexpected failure to make logical progress');
  }
  return trace;
}

module.exports={matching,propagate,approximateOutcomes,advise,starOpening,play};
if(require.main===module) {
  const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const model=new Model(input.materials||10,input.slots||10,input.legal||null),state=new State(model);
  for(const turn of input.history||[])state.update(model.encode(turn.query),turn.response);
  if(!state.turns)console.log(JSON.stringify({next:model.decode(starOpening(model)),reason:'A-star opening'},null,2));
  else if(state.done)console.log(JSON.stringify({complete:true}));
  else {
    const result=advise(state,input.strategy||'adaptive');
    console.log(JSON.stringify({next:model.decode(result.query),
      knownPresent:[...result.info.present].map(v=>model.names[v]),
      knownAbsent:[...result.info.absent].map(v=>model.names[v]),
      candidates:result.info.domains.map(d=>d.map(v=>model.names[v])),
      choices:result.details?.map((d,i)=>d?{slot:i+1,query:model.names[d.q],status:d.status,
        estimatedInformationBits:d.gain,estimatedFeedbackProbabilities:Object.fromEntries(['G','B','P','X'].map((c,j)=>[c,d.probs[j]]))}:null),
      note:'Logical deductions are exact; probabilities and query selection are heuristic.'},null,2));
  }
}
