import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESETS,weightedMoments,futureValue,assessSuitability,simulatePortfolio,rebalancePortfolio,stressScenarios,analyzeWealth} from '../engine.js';
const approx=(actual,expected,epsilon=1e-7)=>assert.ok(Math.abs(actual-expected)<epsilon,`expected ${actual} ≈ ${expected}`);

test('Aurel: moments respect asset allocation and zero-volatility cash limit',()=>{
 const m=weightedMoments(PRESETS.balanced.weights,.007);
 assert.ok(m.annualReturn>0&&m.annualReturn<.2);
 assert.ok(m.volatility>0);
 assert.throws(()=>weightedMoments([.6,.3,.1,.1]),/100%/);
});
test('Aurel: future value zero interest and positive growth',()=>{
 approx(futureValue(1000,100,1,0),2200);
 assert.ok(futureValue(1000,100,1,.1)>2200);
});
test('Aurel: suitability flags growth portfolio for low-risk client',()=>{
 assert.match(assessSuitability('Low','growth'),/higher model risk/);
 assert.match(assessSuitability('High','conservative'),/does not exceed/);
});
test('Aurel: reproducible Monte Carlo simulation and goal frequency',()=>{
 const x={pv:100000,monthly:1000,years:5,goal:150000,annualReturn:.06,volatility:.12,paths:1000,seed:10};
 const a=simulatePortfolio(x),b=simulatePortfolio(x);
 assert.deepEqual(a,b);assert.ok(a.p10<=a.median&&a.median<=a.p90);
 assert.ok(a.goalProbability>=0&&a.goalProbability<=1);
});
test('Aurel: rebalancing trades net to zero and stress shapes correct',()=>{
 const p=rebalancePortfolio(100000,[.6,.2,.1,.1],[.45,.35,.1,.1]);
 approx(p.reduce((s,x)=>s+x.trade,0),0);approx(p[0].trade,-15000);approx(p[1].trade,15000);
 assert.equal(stressScenarios([.45,.35,.1,.1],100000).length,3);
 const a=analyzeWealth({});assert.equal(a.trades.length,4);assert.equal(a.stresses.length,3);
});

