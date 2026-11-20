// The panel reads through the simulation's public API. All writes use the
// controller's callbacks, so map interventions and saved history share a clock.
const format = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3})
const percent = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1,style:'percent'})
const definitions = [
  ['temperature','Temperatura','K'], ['humidity','Índice de umidade','%'],
  ['energy','Energia disponível','E/passo'], ['nutrient','Nutriente livre','M']
]

function shown(value) {
  if (value>0 && value<0.001) return '< 0,001'
  return format.format(value)
}

export function readWorldVariables(world,point={}) {
  const env=world.environment
  const x=Number.isFinite(point?.x)?Math.max(0,Math.min(1,point.x)):0.5
  const y=Number.isFinite(point?.y)?Math.max(0,Math.min(1,point.y)):0.5
  const index=env.index(x,y), local=env.sample(x,y), global=env.getMetrics()
  return {
    tick:world.tick, seed:world.seed, lightForcing:env.lightForcing,
    x,y, column:index%env.size+1, row:Math.floor(index/env.size)+1,
    cells:env.size**2, nutrientInputTotal:world.nutrientInputTotal,
    values:{
      temperature:[local.temperatureK,global.meanTemperatureK],
      humidity:[local.humidity,global.meanHumidity],
      energy:[local.energy,global.meanEnergy],
      nutrient:[local.nutrient,global.availableNutrient/(env.size**2)]
    }
  }
}

function node(tag,text,cls) {
  const n=document.createElement(tag)
  if(text!=null)n.textContent=text
  if(cls)n.className=cls
  return n
}

function write(n,text) {
  if(n.textContent!==text)n.textContent=text
}

export function mountWorldVariables(container,{onLightForcing,onNutrientPulse}) {
  const section=node('section',null,'ev-panel')
  const heading=node('h2','Intervenções')
  const lightLabel=node('label','Luz incidente no planeta')
  const light=document.createElement('select')
  light.id='ev-light'
  lightLabel.htmlFor=light.id
  for(const value of ['0','.65','1','1.25','1.3','2']) {
    const option=node('option',percent.format(Number(value)))
    option.value=value
    light.append(option)
  }
  const custom=node('option')
  custom.hidden=true
  light.append(custom)
  const lightRow=node('div',null,'ev-actions')
  lightRow.append(lightLabel, light)
  const lightHelp=node('p','A luz altera o orçamento de energia neste passo. A temperatura responde nos passos seguintes.')
  const pulseForm=node('form')
  const massLabel=node('label','Massa do pulso no ponto (M)')
  const mass=document.createElement('input')
  mass.id='ev-pulse-mass'
  massLabel.htmlFor=mass.id
  mass.type='number'; mass.min='0'; mass.max='1000000'; mass.step='any'; mass.value='1'; mass.required=true
  mass.style.width='6.5em'
  const row=node('div',null,'ev-actions')
  const submit=node('button','Aplicar no ponto','secondary')
  submit.type='submit'; submit.id='ev-pulse'
  row.append(mass,submit)
  pulseForm.append(massLabel,row)
  const result=node('p',null,'ev-foot')
  result.id='ev-variable-feedback'
  result.setAttribute('role','status')
  result.hidden=true
  section.append(heading,lightRow,lightHelp,pulseForm,result)

  const measures=node('section',null,'ev-panel')
  const title=node('h2','Leituras atuais')
  const reference=node('p',null,'ev-chart-caption')
  reference.id='ev-variable-point'
  const table=node('table')
  table.id='ev-variable-table'
  table.setAttribute('aria-label','Medidas na célula da sonda e na célula média da superfície')
  const head=node('thead'),header=node('tr')
  for(const label of ['Grandeza','No ponto','Média']) {
    const th=node('th',label)
    th.scope='col'
    header.append(th)
  }
  head.append(header)
  const body=node('tbody'),cells={}
  for(const [key,label,unit] of definitions) {
    const tr=node('tr'), th=node('th'),unitLabel=node('small',unit), local=node('td'), average=node('td')
    tr.dataset.variable=key
    th.scope='row'
    th.style.whiteSpace='normal'
    unitLabel.style.color='var(--ev-soft)'
    th.append(document.createTextNode(label+' '),unitLabel)
    tr.append(th,local,average);body.append(tr);cells[key]=[local,average]
  }
  table.append(head,body)
  const scale=node('p',null,'ev-foot')
  const external=node('p',null,'ev-foot')
  measures.append(title,reference,table,scale,external)
  container.replaceChildren(section,measures)
  let current=null, sample=null

  function status(text) {write(result,text);result.hidden=!text}
  function update(world,position) {
    if(!world)return
    if(world!==current){current=world;status('');mass.value='1'}
    sample=readWorldVariables(world,position)
    const preset=[...light.options].find(option=>option!==custom && Number(option.value)===sample.lightForcing)
    custom.hidden=Boolean(preset)
    if(!preset){custom.value=String(sample.lightForcing);write(custom,percent.format(sample.lightForcing))}
    light.value=(preset||custom).value
    write(reference,'Passo '+sample.tick+' · célula '+sample.column+', '+sample.row+' · semente '+sample.seed)
    for(const [key] of definitions){
      for(let index=0;index<2;index++){
        const v=sample.values[key][index]
        write(cells[key][index],key==='humidity'?percent.format(v):shown(v))
      }
    }
    write(scale,'A média usa as '+sample.cells+' células. E representa energia e M representa massa no modelo.')
    write(external,'O planeta recebeu '+shown(sample.nutrientInputTotal)+' M em pulsos externos.')
  }

  light.addEventListener('change',()=>{
    if(!current)return
    const before=sample, next=Number(light.value), world=current
    if(!Number.isFinite(next)||next<0||next>2){update(world,before);return}
    try{
      const changed=onLightForcing(next)
      if(current!==world)return
      update(world,before)
      if(changed===false || sample.lightForcing!==next){status('A luz permaneceu em '+percent.format(sample.lightForcing)+'.');return}
      status('Passo '+sample.tick+' · energia média por célula de '+shown(before.values.energy[1])+
        ' para '+shown(sample.values.energy[1])+' E/passo.')
    }catch{update(world,before);status('Falha ao atualizar a luz. A leitura mostra o valor aplicado.')}
  })
  pulseForm.addEventListener('submit',event=>{
    event.preventDefault()
    if(!current)return
    const value=mass.valueAsNumber
    if(!Number.isFinite(value)||value<=0||value>1e6){status('Informe uma massa positiva de até 1.000.000 M.');return}
    const before=sample, world=current
    try{
      const changed=onNutrientPulse(value,{x:before.x,y:before.y})
      if(current!==world)return
      update(world,before)
      const received=sample.nutrientInputTotal-before.nutrientInputTotal
      if(changed===false||!(received>0)){status('O mundo não recebeu o pulso.');return}
      status('Passo '+sample.tick+' · célula '+sample.column+', '+sample.row+' recebeu '+shown(received)+
        ' M. Nutriente livre de '+shown(before.values.nutrient[0])+' para '+shown(sample.values.nutrient[0])+' M.')
    }catch{update(world,before);status('Falha ao aplicar o pulso. Confira o aporte acumulado.')}
  })
  return {update}
}
