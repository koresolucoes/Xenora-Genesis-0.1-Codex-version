// All local readings come from the selected planetary cell; the element table
// is a frozen record at transfer, in independent units from the virtual fluid.
const panels = new WeakMap()
const number = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3})
const names = {H:'Hidrogênio',He:'Hélio',C:'Carbono',O:'Oxigênio',Mg:'Magnésio',Si:'Silício',Fe:'Ferro'}
const waterKinds = [
  ['Líquido','water','#59aeba'], ['Gelo','ice','#c1dadd'], ['Vapor','vapor','#ac94bd']
]

function element(tag,text,cls) {
  const n=document.createElement(tag)
  if(text!=null) n.textContent=text
  if(cls) n.className=cls
  return n
}

function quantity(value) {
  if (value>0 && value<0.001) return '< 0,001'
  return number.format(value)
}

function createPanel(container) {
  const section=element('section',null,'ev-panel')
  section.setAttribute('aria-label','Matéria e origem')
  const heading=element('h2','Matéria e origem')
  const caption=element('p'), bar=element('div')
  bar.setAttribute('role','img')
  Object.assign(bar.style,{display:'flex',height:'8px',borderRadius:'4px',overflow:'hidden',
    background:'#384640',marginBlock:'7px'})
  const parts=waterKinds.map(([,key,color])=>{
    const span=element('span')
    span.dataset.fluid=key
    span.style.backgroundColor=color
    bar.append(span)
    return span
  })
  const legend=element('div')
  Object.assign(legend.style,{display:'flex',gap:'4px 12px',flexWrap:'wrap',
    font:'11px/1.5 var(--mono)',color:'var(--ev-soft)'})
  const values=waterKinds.map(([label,,color])=>{
    const row=element('span'), dot=element('span','●'), value=element('span')
    dot.style.color=color
    dot.setAttribute('aria-hidden','true')
    row.append(dot,document.createTextNode(' '+label+' '),value)
    legend.append(row)
    return value
  })
  const local=element('p'), origin=element('p'), details=element('details'), summary=element('summary','Elementos no disco de origem')
  details.append(summary)
  summary.style.cursor='pointer'
  section.append(heading,caption,bar,legend,local,origin,details)
  container.replaceChildren(section)
  return {bar,parts,values,caption,local,origin,details,originSeen:null}
}

function showOrigin(panel,origin) {
  panel.originSeen=origin
  const el=panel.origin
  if(origin.kind==='generated') {
    el.textContent='O relevo, a água e o substrato desta superfície foram gerados pela semente '+origin.seed+
      '. O inventário elementar acompanha amostras transferidas do laboratório Origens.'
  } else {
    el.textContent='Amostra do disco no passo '+origin.tick+' da semente '+origin.seed+' · '+
      quantity(origin.mineralUnits)+' lotes de Mg₂SiO₄. Cada fórmula reúne dois Mg, um Si e quatro O.'
  }
  const rows=origin.elementLedger
  panel.details.hidden=!rows?.length
  panel.details.querySelector('[data-source-ledger]')?.remove()
  if(!rows?.length) return
  const ledger=element('div')
  ledger.dataset.sourceLedger='true'
  ledger.append(element('p','Estoques do disco no instante da coleta, em lotes de núcleos. A coluna mineral conta os núcleos incorporados ao silicato.'))
  const table=element('table'), head=element('thead'), headRow=element('tr')
  for(const title of ['Elemento','Gás','Mineral']) {
    const th=element('th',title)
    th.scope='col'
    headRow.append(th)
  }
  head.append(headRow)
  const body=element('tbody')
  for(const row of rows) {
    const tr=element('tr'), label=element('th',row.symbol+' · '+names[row.symbol])
    label.scope='row'
    tr.title='Primordial '+quantity(row.primordial)+' · ejeção estelar '+quantity(row.ejecta)+
      ' · retido em estrelas '+quantity(row.stellar)+' · exportado '+quantity(row.exported)+' lotes'
    tr.append(label,element('td',quantity(row.gas)),element('td',quantity(row.mineral)))
    body.append(tr)
  }
  table.append(head,body)
  ledger.append(table)
  panel.details.append(ledger)
}

export function renderMatterInspector(container,world,selection=null) {
  const env=world?.environment
  if(!container || !env) return
  let panel=panels.get(container)
  if(!panel) { panel=createPanel(container); panels.set(container,panel) }
  if(panel.originSeen!==env.origin) showOrigin(panel,env.origin)
  const x=Number.isFinite(selection?.x)?selection.x:0.5
  const y=Number.isFinite(selection?.y)?selection.y:0.5
  const i=env.index(x,y)
  const sample=env.sample(x,y)
  const sum=sample.water+sample.ice+sample.vapor
  const total='Água na célula '+(i%env.size+1)+', '+(Math.floor(i/env.size)+1)+' · '+quantity(sum)+' W'
  panel.caption.textContent=total
  panel.bar.setAttribute('aria-label',total+' — '+waterKinds.map(([label,key])=>label+' '+quantity(sample[key])+' W').join(', '))
  for(let j=0;j<waterKinds.length;j++){
    const [label,key]=waterKinds[j]
    const fraction=sum ? sample[key]/sum : 0
    panel.parts[j].style.width=(100*fraction)+'%'
    panel.parts[j].title=label+' · '+quantity(sample[key])+' W'
    panel.values[j].textContent=quantity(sample[key])
  }
  panel.local.textContent='Na célula há '+quantity(sample.nutrient)+' M de nutriente disponível e '+
    quantity(env.boundNutrient[i])+' M ligado ao substrato. Índice mineral '+quantity(sample.mineral)+' de 1.'
  panel.local.title='W mede a coluna de água local. M mede massa virtual de nutriente. O índice mineral descreve a presença relativa de substrato.'
}
