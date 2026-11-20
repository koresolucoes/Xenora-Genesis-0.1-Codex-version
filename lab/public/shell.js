for (const trigger of document.querySelectorAll('[data-open]')) trigger.addEventListener('click', () => document.getElementById(trigger.dataset.open).showModal());
for (const close of document.querySelectorAll('[data-close]')) close.addEventListener('click', () => close.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', e => { if (e.target === dialog && (e.clientX < dialog.getBoundingClientRect().left || e.clientX > dialog.getBoundingClientRect().right || e.clientY < dialog.getBoundingClientRect().top || e.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
document.querySelector('[data-tab="field"]').addEventListener('click', () => { document.querySelector('#lagoon').focus({preventScroll:true}); });
const expand = document.getElementById('expand');
expand.addEventListener('click', async () => {
 const stage = document.getElementById('map-region');
 if (document.fullscreenElement) {await document.exitFullscreen(); return;}
 if (stage.requestFullscreen) {try {await stage.requestFullscreen(); return;} catch {}}
 stage.classList.toggle('enlarged');expand.setAttribute('aria-expanded', String(stage.classList.contains('enlarged')));
});
document.addEventListener('fullscreenchange',()=>expand.setAttribute('aria-expanded',String(!!document.fullscreenElement)));
document.addEventListener('keydown', e=>{ if(e.key==='Escape') document.getElementById('map-region').classList.remove('enlarged'); });