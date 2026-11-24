import test from 'node:test';
import assert from 'node:assert/strict';
import {wealthRisk} from '../advanced.js';
const x={returns:[.1,-.2,.1],benchmark:[0,0,0],annualRiskFree:0,inflation:.05,nominal:.1,annualTax:.2};test('drawdown, benchmark, purchasing power',()=>{const a=wealthRisk(x);assert.ok(Math.abs(a.drawdown-.2)<1e-8);assert.equal(a.benchmarkReturn,0);assert.ok(Math.abs(a.realAfterTax-(1.08/1.05-1))<1e-8)});test('invalid periods and undefined ratios',()=>{assert.throws(()=>wealthRisk({...x,benchmark:[0]}));assert.equal(wealthRisk({...x,returns:[0,0,0]}).sharpe,null)});
