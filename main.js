import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

let MARKER_PX = 36
let MIN_SEG = 0.15
let LIFT = 0.01

const canvas = document.querySelector('#c')
const renderer = new THREE.WebGLRenderer({canvas, antialias:false})
renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x202025)

const cam = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, .01, 2000)
cam.position.set(0,18,22)

const controls = new OrbitControls(cam, renderer.domElement)
controls.enableDamping = true
controls.enabled = false
let camDirty = true
controls.addEventListener('change',()=>camDirty=true)

scene.add(new THREE.AmbientLight(0xffffff,.6))
const sun = new THREE.DirectionalLight(0xffffff,1.5)
sun.position.set(10,20,10)
scene.add(sun)

const floorPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1000,1000),
  new THREE.MeshBasicMaterial({visible:false})
)
floorPlane.rotateX(-Math.PI/2)
scene.add(floorPlane)

let COURT = {minX:-14,maxX:14,minZ:-7.5,maxZ:7.5}

const ray = new THREE.Raycaster()
const vec2 = new THREE.Vector2()

function getPoint(e){
  const r = renderer.domElement.getBoundingClientRect()
  vec2.x = ((e.clientX - r.left)/r.width)*2-1
  vec2.y = -((e.clientY - r.top)/r.height)*2+1
  ray.setFromCamera(vec2,cam)
  const hit = ray.intersectObject(floorPlane,false)[0]
  if(!hit) return null
  const p = hit.point.clone()
  p.x = Math.min(COURT.maxX, Math.max(COURT.minX,p.x))
  p.z = Math.min(COURT.maxZ, Math.max(COURT.minZ,p.z))
  return p
}

const lineMat = new THREE.LineBasicMaterial({
  color:0xfff07a,
  transparent:true,
  opacity:.9,
  blending:THREE.AdditiveBlending,
  depthTest:false
})
lineMat.depthWrite=false
lineMat.renderOrder=999

const colors = ['#e74c3c','#f39c12','#27ae60','#2980b9','#8e44ad']

function makeMarker(num,pos,c){
  const col = c || colors[num-1] || '#4b82f0'
  const base = new THREE.Mesh(
    new THREE.CircleGeometry(.45,48),
    new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.85})
  )
  base.rotation.x=-Math.PI/2
  base.position.y=LIFT
  const s=128
  const cv=document.createElement('canvas')
  cv.width=cv.height=s
  const ctx=cv.getContext('2d')
  ctx.fillStyle=col
  ctx.beginPath();ctx.arc(s/2,s/2,s*0.45,0,Math.PI*2);ctx.fill()
  ctx.fillStyle='#fff'
  ctx.font='bold 72px system-ui,Arial'
  ctx.textAlign='center'
  ctx.textBaseline='middle'
  ctx.fillText(String(num),s/2,s/2)
  const tex=new THREE.CanvasTexture(cv)
  const label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}))
  label.center.set(.5,0)
  label.position.y=LIFT+.02
  const g=new THREE.Group()
  g.add(base)
  g.add(label)
  g.userData.label=label
  if(pos) g.position.copy(pos)
  return g
}

let mode='place'
let activeNum=1
const markerMap=new Map()
const allLabels=[]
const logStack=[]
const scribbles=[]

const $=id=>document.getElementById(id)
const btnPlace=$('tool-place')
const btnDraw=$('tool-draw')
const btnMove=$('tool-move')
const btnUndo=$('undo')
const btnClear=$('clear')
const numBtns=[...document.querySelectorAll('.player')]

function setMode(m){
  mode=m
  btnPlace.classList.toggle('active',m==='place')
  btnDraw.classList.toggle('active',m==='draw')
  btnMove.classList.toggle('active',m==='move')
  controls.enabled = (m==='move')
}
btnPlace.onclick=()=>setMode('place')
btnDraw.onclick=()=>setMode('draw')
btnMove.onclick=()=>setMode('move')
numBtns.forEach(b=>{
  b.onclick=()=>{
    numBtns.forEach(x=>x.classList.remove('active'))
    b.classList.add('active')
    activeNum=parseInt(b.dataset.num||'1')
  }
})
numBtns[0].classList.add('active')
btnUndo.onclick=()=>undoLast()
btnClear.onclick=()=>wipeAll()

// load court
new GLTFLoader().load('./basketball_court.glb',(g)=>{
  const court=g.scene
  scene.add(court)
  const box=new THREE.Box3().setFromObject(court)
  const size=box.getSize(new THREE.Vector3())
  const center=box.getCenter(new THREE.Vector3())
  court.position.sub(center)
  const sc=28/Math.max(size.x,.0001)
  court.scale.setScalar(sc)
  const rc=new THREE.Raycaster()
  const ys=[]
  const down=new THREE.Vector3(0,-1,0)
  for(let gx=-3;gx<=3;gx++){
    for(let gz=-3;gz<=3;gz++){
      rc.set(new THREE.Vector3(gx*1.5,1000,gz*1.5),down)
      const hits=rc.intersectObject(court,true)
      const hit=hits.find(h=>h.face&&h.face.normal.y>.5)||hits[0]
      if(hit) ys.push(hit.point.y)
    }
  }
  ys.sort((a,b)=>a-b)
  const woodY=ys.length?ys[(ys.length/2)|0]:0
  floorPlane.position.y=woodY+.0001
  const b2=new THREE.Box3().setFromObject(court)
  const s2=b2.getSize(new THREE.Vector3())
  const maxDim=Math.max(s2.x,s2.y,s2.z)
  const fov=cam.fov*Math.PI/180
  const dist=(maxDim/2)/Math.tan(fov/2)
  cam.near=Math.max(dist/100,.01)
  cam.far=dist*100
  cam.updateProjectionMatrix()
  cam.position.set(0,dist*.6,dist*1.2)
  controls.target.set(0,0,0)
  controls.maxDistance=maxDim*4
  controls.update()
  camDirty=true
})

function dropMarker(p,n){
  const m=markerMap.get(n)
  if(!m){
    const mk=makeMarker(n)
    mk.position.copy(p)
    scene.add(mk)
    markerMap.set(n,mk)
    allLabels.push(mk.userData.label)
    logStack.push({type:'add',number:n,obj:mk})
  }else{
    const old=m.position.clone()
    m.position.copy(p)
    logStack.push({type:'move',obj:m,prev:old})
  }
  camDirty=true
}

let drawing=false
let currLine=null
let pathPoints=[]

function startLine(p){
  drawing=true
  p.y=floorPlane.position.y+.02
  pathPoints=[p.clone()]
  currLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPoints),lineMat)
  scene.add(currLine)
  controls.enabled=false
}

function addLine(p){
  if(!p) return
  p.y=floorPlane.position.y+.02
  const last=pathPoints[pathPoints.length-1]
  if(!last||last.distanceTo(p)<MIN_SEG) return
  pathPoints.push(p.clone())
  currLine.geometry.dispose()
  currLine.geometry=new THREE.BufferGeometry().setFromPoints(pathPoints)
}

function endLine(){
  if(!drawing) return
  drawing=false
  if(pathPoints.length<2){
    scene.remove(currLine)
    currLine.geometry.dispose()
  }else{
    logStack.push({type:'stroke',obj:currLine})
    scribbles.push(currLine)
  }
  currLine=null
  pathPoints=[]
}

let lastPick=0
const PICK_MS=16

renderer.domElement.addEventListener('pointerdown',e=>{
  if(mode==='move') return
  const p=getPoint(e)
  if(!p) return
  if(mode==='place') dropMarker(p,activeNum)
  else if(mode==='draw') startLine(p)
})
renderer.domElement.addEventListener('pointermove',e=>{
  if(!drawing||mode!=='draw') return
  const now=performance.now()
  if(now-lastPick<PICK_MS) return
  lastPick=now
  addLine(getPoint(e))
})
window.addEventListener('pointerup',endLine)
renderer.domElement.addEventListener('pointerleave',endLine)

function undoLast(){
  if(drawing){endLine();return}
  const last=logStack.pop()
  if(!last)return
  if(last.type==='stroke'){
    scene.remove(last.obj)
    last.obj.geometry.dispose()
    const i=scribbles.indexOf(last.obj)
    if(i>=0)scribbles.splice(i,1)
  }else if(last.type==='add'){
    scene.remove(last.obj)
    markerMap.delete(last.number)
  }else if(last.type==='move'){
    last.obj.position.copy(last.prev)
  }
  camDirty=true
}

function wipeAll(){
  scribbles.forEach(s=>{scene.remove(s);s.geometry.dispose()})
  scribbles.length=0
  markerMap.forEach(m=>scene.remove(m))
  markerMap.clear()
  allLabels.length=0
  logStack.length=0
  camDirty=true
}

function savePlay(){
  let name=prompt('play name?')
  if(!name)return
  const data={
    players:[...markerMap.entries()].map(([n,o])=>({n,pos:o.position.clone(),col:colors[n-1]})),
    lines:scribbles.map(l=>({points:l.geometry.attributes.position.array}))
  }
  localStorage.setItem('play_'+name,JSON.stringify(data))
  alert('saved '+name)
  updateList()
}

function loadPlay(name){
  const d=JSON.parse(localStorage.getItem('play_'+name))
  if(!d)return alert('not found')
  wipeAll()
  d.players.forEach(p=>{
    const mk=makeMarker(p.n,new THREE.Vector3(p.pos.x,p.pos.y,p.pos.z),p.col)
    scene.add(mk)
    markerMap.set(p.n,mk)
    allLabels.push(mk.userData.label)
  })
  d.lines.forEach(l=>{
    const pts=[]
    const arr=l.points
    for(let i=0;i<arr.length;i+=3){
      pts.push(new THREE.Vector3(arr[i],arr[i+1],arr[i+2]))
    }
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),lineMat)
    line.renderOrder=999
    scene.add(line)
    scribbles.push(line)
  })
  camDirty=true
  alert('loaded '+name)
}

function updateList(){
  const sel=document.getElementById('playList')
  if(!sel)return
  sel.innerHTML=''
  Object.keys(localStorage).filter(k=>k.startsWith('play_')).forEach(k=>{
    const o=document.createElement('option')
    o.value=k.slice(5)
    o.textContent=k.slice(5)
    sel.appendChild(o)
  })
}

const ui=document.querySelector('.ui')
const saveCard=document.createElement('div')
saveCard.className='card'
saveCard.innerHTML=`
  <button id="savePlay" class="btn small">Save</button>
  <select id="playList" class="btn small" style="padding:6px 8px;color:white;background:transparent;border:1px solid rgba(255,255,255,.1)"></select>
  <button id="loadPlay" class="btn small">Load</button>
`
ui.appendChild(saveCard)
document.getElementById('savePlay').onclick=savePlay
document.getElementById('loadPlay').onclick=()=>{
  const n=document.getElementById('playList').value
  if(n)loadPlay(n)
}
updateList()

function resize(){
  renderer.setSize(window.innerWidth,window.innerHeight)
  cam.aspect=window.innerWidth/window.innerHeight
  cam.updateProjectionMatrix()
  camDirty=true
}
window.addEventListener('resize',resize)

const tmp=new THREE.Vector3()
function fitLabel(s,px){
  s.getWorldPosition(tmp)
  const d=cam.position.distanceTo(tmp)
  const v=cam.fov*Math.PI/180
  const worldH=2*Math.tan(v/2)*d
  const per=worldH/renderer.domElement.clientHeight
  const sc=per*px
  s.scale.set(sc,sc,1)
}
function sizeLabels(){
  for(let i=0;i<allLabels.length;i++)fitLabel(allLabels[i],MARKER_PX)
}

// render loop
if(window.__court3dRaf)cancelAnimationFrame(window.__court3dRaf)
function loop(){
  window.__court3dRaf=requestAnimationFrame(loop)
  controls.update()
  if(camDirty){sizeLabels();camDirty=false}
  renderer.render(scene,cam)
}
loop()
resize()
