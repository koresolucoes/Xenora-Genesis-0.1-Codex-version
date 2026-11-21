import test from "node:test";
import assert from "node:assert/strict";
import {materialInventory,molecularFormula,sampleProperties} from "../public/src/material-properties.js";

const water=[{element:"H",electrons:1},{element:"O",electrons:8},{element:"H",electrons:1}];
test("a molecular inventory preserves nuclear composition and neutral charge",()=>{
  const stock=materialInventory(water);
  assert.equal(molecularFormula(water),"H2O");
  assert.equal(stock.protons,10);assert.equal(stock.neutrons,8);
  assert.equal(stock.electrons,10);assert.equal(stock.chargeElementary,0);
  assert.ok(Math.abs(stock.massU-18.01056468403)<1e-10);
  const different=[{element:"C",electrons:6},...water];
  assert.equal(molecularFormula(different),"CH2O");
});
test("sample density responds to sample volume and the pressure comparison uses components",()=>{
  let volumeNm3=8;
  const world={particles:water,getMetrics:()=>({volumeNm3,temperatureK:300}),molecules:()=>[{members:[1,2,3]}]};
  const a=sampleProperties(world);volumeNm3=16;const b=sampleProperties(world);
  assert.equal(a.densityKgM3,2*b.densityKgM3);
  assert.equal(a.idealPressurePa,2*b.idealPressurePa);
  assert.equal(a.phase,"Não determinada");
});

test("unbound atoms contribute independent components to the ideal pressure comparison",()=>{
  const world={particles:water,getMetrics:()=>({volumeNm3:8,temperatureK:300}),molecules:()=>[]};
  const material=sampleProperties(world);
  assert.equal(material.moleculeCount,3);
  assert.ok(Math.abs(material.idealPressurePa-3*1.380649e-23*300/(8e-27))<1e-6);
});
