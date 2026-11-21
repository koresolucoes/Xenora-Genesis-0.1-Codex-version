function bounded(n, max) { return Math.max(0, Math.min(max, n)); }

export function cameraAt(scale, point = {x:0.5,y:0.5}) {
  const extent = 1 / scale;
  return {scale, x:bounded(point.x - extent / 2, 1 - extent), y:bounded(point.y - extent / 2, 1 - extent)};
}

export function installFieldLens(view, getFocus, redraw) {
  const canvas = view.canvas;
  const toolbar = document.createElement("div");
  toolbar.className = "field-lens-tools";
  toolbar.setAttribute("aria-label","Ampliação da sonda");
  toolbar.innerHTML = '<button type="button" aria-label="Diminuir ampliação">−</button><output aria-live="polite">1×</output><button type="button" aria-label="Aumentar ampliação">+</button><button type="button" class="lens-center">Centrar na sonda</button>';
  canvas.parentElement.append(toolbar);
  const [less,more,center] = toolbar.querySelectorAll("button");
  const scales = [1,2,4];
  let level = 0;
  function apply(focus) {
    view.camera = cameraAt(scales[level],focus || undefined);
    toolbar.querySelector("output").textContent = scales[level] + "×";
    less.disabled = level === 0;
    more.disabled = level === scales.length - 1;
    center.hidden = level === 0;
    canvas.classList.toggle("field-lens-on",level > 0);
  }
  function setLevel(value) {
    level = value;
    apply(getFocus()); redraw();
  }
  less.onclick = () => setLevel(Math.max(0,level-1));
  more.onclick = () => setLevel(Math.min(scales.length-1,level+1));
  center.onclick = () => { apply(getFocus()); redraw(); };
  let drag = null, suppressClick = false;
  canvas.addEventListener("pointerdown", ev => {
    if (!level || ev.button !== 0) return;
    suppressClick = false;
    drag = {px:ev.clientX,py:ev.clientY, x:view.camera.x, y:view.camera.y, id:ev.pointerId};
  });
  canvas.addEventListener("pointermove", ev => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.px, dy = ev.clientY - drag.py;
    if (!suppressClick && Math.hypot(dx,dy) < 5) return;
    suppressClick = true;
    if (!canvas.hasPointerCapture?.(ev.pointerId)) canvas.setPointerCapture?.(ev.pointerId);
    const {width,height} = canvas.getBoundingClientRect();
    const s = view.camera.scale, max = 1 - 1/s;
    view.camera = {scale:s,x:bounded(drag.x-dx/(s*width),max),y:bounded(drag.y-dy/(s*height),max)};
    redraw();
  });
  function stop() { drag = null; }
  canvas.addEventListener("pointerup",stop);
  canvas.addEventListener("pointercancel",stop);
  canvas.addEventListener("click",event=>{
    if (suppressClick) { event.stopImmediatePropagation(); suppressClick=false; }
  },true);
  apply();
  return {reset:()=>setLevel(0)};
}
