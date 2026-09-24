(function(root) {
  'use strict';
  const ids = [37,158,327,582,741,916], markerSize = 7/9;
  // Matches MockARCube's six Quad transforms: outward normal, marker right, marker up.
  const bases = [
    [[0,0,-1],[1,0,0],[0,1,0]], [[0,1,0],[1,0,0],[0,0,1]],
    [[1,0,0],[0,0,1],[0,1,0]], [[0,-1,0],[1,0,0],[0,0,-1]],
    [[-1,0,0],[0,0,-1],[0,1,0]], [[0,0,1],[1,0,0],[0,-1,0]]
  ];
  const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p=>p.map(x=>x/2));
  const faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[1,2,6,5],[0,4,7,3]];
  // FACE_A..F colors; faces[] is not in A..F order, so map each quad by its outward normal.
  const faceColors = ['#ff5268','#ffdb54','#49a9ff','#48df9d','#b581ff','#ff9b42'];
  const faceMarker = faces.map(face=>{const c=[0,1,2].map(i=>face.reduce((s,v)=>s+vertices[v][i],0)/2);
    return bases.findIndex(([n])=>n.every((x,i)=>Math.abs(x-c[i])<1e-9));});
  const dot = (a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  function solve(rows, values, n) {
    const a = Array.from({length:n},()=>Array(n+1).fill(0));
    rows.forEach((r,k)=>{for(let i=0;i<n;i++){for(let j=0;j<n;j++) a[i][j]+=r[i]*r[j]; a[i][n]+=r[i]*values[k];}});
    for(let i=0;i<n;i++) {
      let pivot=i; for(let j=i+1;j<n;j++) if(Math.abs(a[j][i])>Math.abs(a[pivot][i])) pivot=j;
      if(Math.abs(a[pivot][i])<1e-10) return null;
      [a[i],a[pivot]]=[a[pivot],a[i]];
      const d=a[i][i]; for(let j=i;j<=n;j++) a[i][j]/=d;
      for(let k=0;k<n;k++) if(k!==i){const f=a[k][i];for(let j=i;j<=n;j++) a[k][j]-=f*a[i][j];}
    }
    const result=a.map(r=>r[n]); return result.every(Number.isFinite)?result:null;
  }
  function worldCorners(id) {
    const basis=bases[ids.indexOf(id)]; if(!basis) return [];
    const [n,r,u]=basis;
    return [[-1,1],[1,1],[1,-1],[-1,-1]].map(([x,y])=>n.map((v,i)=>v*.5+markerSize*.5*(r[i]*x+u[i]*y)));
  }
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const l=Math.hypot(...a);return a.map(x=>x/l);};
  // Camera matrix P (3x4, normalized image coords, P[2][3]=1) -> projector returning pixels and depth d.
  function projector(P,width,height,scale) {
    return p=>{const [x,y,z]=p,d=P[2][0]*x+P[2][1]*y+P[2][2]*z+P[2][3];
      return d>.05?{x:width/2+scale*(P[0][0]*x+P[0][1]*y+P[0][2]*z+P[0][3])/d,y:height/2+scale*(P[1][0]*x+P[1][1]*y+P[1][2]*z+P[1][3])/d,d}:null;};
  }
  // Box coordinates follow Unity's (left-handed) axes, so camera rotations have det -1: r3 = -(r1 x r2).
  const HANDEDNESS=-1;
  // P ~ K[R|T] with K=diag(f,f,1): rows 1-2 give r1,r2 (also for a nearly orthographic camera,
  // where row 3 is only noise). Returns the focal length in normalized units and R.
  function decompose(P) {
    const m=P.map(r=>r.slice(0,3)),r1=unit(m[0]),k12=dot(m[1],r1),v2=m[1].map((x,i)=>x-k12*r1[i]),r2=unit(v2);
    const r3=cross(r1,r2).map(x=>HANDEDNESS*x);
    const focal=(Math.hypot(...m[0])+Math.hypot(...v2))/2/Math.max(1e-9,Math.abs(dot(m[2],r3)));
    return {focal:Math.min(MAX_FOCAL,Math.max(.3,focal)),rotation:[r1,r2,r3]};
  }
  const MAX_FOCAL=200;
  // Candidates closer than this are treated as one ambiguous measurement and merged. Measured on
  // synthetic frontal views with 1px corner noise: 20 leaves a real 15deg tilt intact (0.7deg error)
  // while cutting invented frontal tilt from 5deg to 0.9deg; 30 starts flattening real tilts.
  const MERGE_DEGREES=20;
  const rotationDistance=(a,b)=>a.reduce((s,r,i)=>s+r.reduce((t,x,j)=>t+(x-b[i][j])**2,0),0);
  const degrees=distance=>Math.sqrt(distance/2)*180/Math.PI; // small-angle size of a rotation difference
  // One face: the local image derivatives at the marker center, seen perpendicular to the viewing ray,
  // give the face axes up to one ambiguity (tilted toward vs away from the camera). Both are built;
  // corner fit decides when perspective is strong, otherwise the one closer to the previous rotation wins.
  // Re-orthonormalizes a blended rotation (Gram-Schmidt keeps it a rotation).
  function orthonormalize(R) {
    const r1=unit(R[0]);
    const r2=unit(R[1].map((x,i)=>x-dot(R[1],r1)*r1[i]));
    const r3=unit(cross(r1,r2).map((x,i)=>x*(dot(cross(r1,r2),R[2])<0?-1:1)));
    return [r1,r2,r3];
  }
  function singlePose(marker,normalized,focal,previous,width,height,scale,smoothing=0) {
    const k=ids.indexOf(marker.id),[n,r,u]=bases[k],o=n.map(x=>x*.5),rows=[],values=[];
    [[-1,1],[1,1],[1,-1],[-1,-1]].forEach(([x,y],i)=>{
      const s=x*markerSize/2,t=y*markerSize/2,[a,b]=normalized(marker.corners[i]);
      rows.push([s,t,1,0,0,0,-a*s,-a*t],[0,0,0,s,t,1,-b*s,-b*t]); values.push(a,b);
    });
    const h=solve(rows,values,8); if(!h) return null;
    // Image position and derivatives at (s,t)=(0,0), as camera rays (x/f, y/f, 1).
    const u0=h[2],v0=h[5],ray=[u0/focal,v0/focal,1],view=unit(ray),length=Math.hypot(...ray);
    const tangent=(du,dv)=>{const d=[du/focal,dv/focal,0],k=dot(d,view);return d.map((x,i)=>(x-k*view[i])/length);};
    const A=tangent(h[0]-u0*h[6],h[3]-v0*h[6]),B=tangent(h[1]-u0*h[7],h[4]-v0*h[7]);
    const aa=dot(A,A),bb=dot(B,B),ab=dot(A,B),c2=aa*bb-ab*ab; if(c2<1e-12) return null;
    const S=(aa+bb-Math.sqrt((aa-bb)**2+4*ab*ab))/(2*c2),D=Math.sqrt(S);
    let pa=Math.sqrt(Math.max(0,1-S*aa)),pb=Math.sqrt(Math.max(0,1-S*bb));
    if(pa>=pb) pb=pa>1e-9?-S*ab/pa:pb; else pa=-S*ab/pb;
    const center=view.map(x=>x*D);
    const candidates=[1,-1].map(sign=>{
      const ar=A.map((x,i)=>D*x+sign*pa*view[i]),au=B.map((x,i)=>D*x+sign*pb*view[i]);
      let an=cross(ar,au); if(dot(an,center)>0) an=an.map(x=>-x); // outward normal faces the camera
      // R maps box axes (r,u,n) to camera axes (ar,au,an): R = [ar au an] * [r u n]^T.
      const R=[0,1,2].map(i=>[0,1,2].map(j=>ar[i]*r[j]+au[i]*u[j]+an[i]*n[j]));
      const T=center.map((x,i)=>x-dot(R[i],o));
      if(T[2]<=0) return null;
      const P=R.map((row,i)=>[...row,T[i]].map(x=>(i<2?focal*x:x)/T[2]));
      const project=projector(P,width,height,scale);
      const error=Math.sqrt(worldCorners(marker.id).reduce((s,w,i)=>{const v=project(w);return s+(v?(v.x-marker.corners[i].x)**2+(v.y-marker.corners[i].y)**2:1e9);},0)/4);
      return {P,R,project,error};
    }).filter(Boolean);
    if(!candidates.length) return null;
    const best=Math.min(...candidates.map(c=>c.error));
    const fits=candidates.filter(c=>c.error<=Math.max(best*2,3));
    let chosen=previous?fits.sort((x,y)=>rotationDistance(x.R,previous)-rotationDistance(y.R,previous))[0]:candidates.find(c=>c.error===best);
    // Nearly frontal: the two candidates are a few degrees apart and fit equally well, so picking one
    // (and then picking it again next frame because it matches the previous rotation) would keep a tilt
    // that corner noise invented. Their midpoint fits the corners just as well and stays put.
    if(candidates.length===2 && degrees(rotationDistance(candidates[0].R,candidates[1].R))<MERGE_DEGREES) {
      const R=orthonormalize(candidates[0].R.map((row,i)=>row.map((x,j)=>(x+candidates[1].R[i][j])/2)));
      chosen=rebuild(R,center,o,focal,marker,width,height,scale)||chosen;
    }
    if(!previous||smoothing<=0) return chosen;
    // Near a frontal view the corners barely constrain the tilt: one pixel of corner noise swings it
    // by several degrees. Blending with the previous rotation steadies it; the marker still fixes
    // position and size, because the face center keeps the distance measured this frame.
    // The blend fades out as the measured rotation moves away from the previous one, so a box that is
    // actually being turned still follows immediately.
    const weight=smoothing*Math.max(0,1-degrees(rotationDistance(chosen.R,previous))/25);
    const R=orthonormalize(chosen.R.map((row,i)=>row.map((x,j)=>x*(1-weight)+previous[i][j]*weight)));
    return rebuild(R,center,o,focal,marker,width,height,scale)||chosen;
  }
  // Rebuilds a pose for a replaced rotation, keeping the face-center distance measured this frame.
  function rebuild(R,center,o,focal,marker,width,height,scale) {
    const T=center.map((x,i)=>x-dot(R[i],o));
    if(T[2]<=0) return null;
    const P=R.map((row,i)=>[...row,T[i]].map(x=>(i<2?focal*x:x)/T[2]));
    const project=projector(P,width,height,scale);
    const error=Math.sqrt(worldCorners(marker.id).reduce((s,w,i)=>{const v=project(w);return s+(v?(v.x-marker.corners[i].x)**2+(v.y-marker.corners[i].y)**2:1e9);},0)/4);
    return {P,R,project,error};
  }
  // options: fov (degrees, used until a focal length is known), focal (from earlier multi-face poses),
  // rotation (previous pose's rotation, resolves the single-face tilt ambiguity),
  // smoothing (0-1, how much of the previous rotation to keep in a single-face pose).
  function estimate(markers,width,height,options={}) {
    if(typeof options==='number') options={fov:options};
    const fov=options.fov??60;
    markers=markers.filter(m=>ids.includes(m.id)); if(!markers.length) return null;
    const scale=Math.max(width,height), normalized=p=>[(p.x-width/2)/scale,(p.y-height/2)/scale];
    let project=null, mode='single', error=0, matrix=null, focal=null, rotation=null;
    if(new Set(markers.map(m=>m.id)).size>=2) {
      const rows=[], values=[], pairs=[];
      for(const m of markers) worldCorners(m.id).forEach((p,i)=>{
        const [x,y,z]=p,[u,v]=normalized(m.corners[i]);
        rows.push([x,y,z,1,0,0,0,0,-u*x,-u*y,-u*z],[0,0,0,0,x,y,z,1,-v*x,-v*y,-v*z]);
        values.push(u,v); pairs.push([p,m.corners[i]]);
      });
      const h=solve(rows,values,11);
      if(h) {
        const P=[h.slice(0,4),h.slice(4,8),[...h.slice(8,11),1]],candidate=projector(P,width,height,scale);
        error=Math.sqrt(pairs.reduce((s,[p,q])=>{const v=candidate(p);return s+(v?(v.x-q.x)**2+(v.y-q.y)**2:1e9);},0)/pairs.length);
        if(error<4 && vertices.every(p=>candidate(p))) {project=candidate;mode='multi';matrix=P;({focal,rotation}=decompose(P));}
      }
    }
    if(!project) {
      const used=options.focal||.5/Math.tan(fov*Math.PI/360);
      const pose=singlePose(markers[0],normalized,used,options.rotation,width,height,scale,options.smoothing||0); if(!pose) return null;
      ({project,error,P:matrix,R:rotation}=pose); focal=null;
      mode=options.rotation?'single-tracked':'single';
    }
    const points=vertices.map(project);
    if(points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>width*4||Math.abs(p.y)>height*4)) return null;
    return {points,project,mode,error,count:markers.length,matrix,focal,rotation};
  }
  // Where the face's own right/up axes point on screen, as unit vectors, so a finger's movement
  // can be read as "along the face" whatever angle the box is held at. null if the face is edge-on.
  function faceScreenAxes(pose,k,transform=p=>p) {
    const [n,r,u]=bases[k],origin=n.map(x=>x*.5);
    const at=(a,b)=>pose.project(transform([0,1,2].map(i=>origin[i]+a*r[i]+b*u[i])));
    const center=at(0,0),right=at(.25,0),up=at(0,.25);
    if(!center||!right||!up) return null;
    const unit2=p=>{const l=Math.hypot(p.x-center.x,p.y-center.y);return l<1e-6?null:{x:(p.x-center.x)/l,y:(p.y-center.y)/l,length:l};};
    const x=unit2(right),y=unit2(up);
    return x&&y?{center,right:x,up:y,size:(x.length+y.length)*2}:null;
  }
  // Arrow lying on a face, pointing along its own axes (dx,dy in face units): shows where to swipe.
  function drawArrow(ctx,pose,k,dx,dy,options={}) {
    const [n,r,u]=bases[k],origin=n.map(x=>x*.5),transform=options.transform||(p=>p);
    const at=(a,b)=>pose.project(transform([0,1,2].map(i=>origin[i]+a*r[i]+b*u[i]+n[i]*.002)));
    // The arrow's own +b axis points along (dx,dy), and it sits a fifth of the face that way,
    // clear of the label in the middle.
    const along=(a,b)=>[-a*dy+(b+.2)*dx,a*dx+(b+.2)*dy];
    const shape=[[-.06,-.22],[.06,-.22],[.06,.06],[.17,.06],[0,.27],[-.17,.06],[-.06,.06]];
    const points=shape.map(([a,b])=>at(...along(a,b)));
    if(points.some(p=>!p))return false;
    // Only when that face is turned toward the camera, judged by its own quad like every other face.
    const quad=faces[faceMarker.indexOf(k)].map(v=>pose.project(transform(vertices[v])));
    if(quad.some(p=>!p))return false;
    const area=quad.reduce((s,p,j)=>{const q=quad[(j+1)%4];return s+p.x*q.y-q.x*p.y;},0);
    if(area<=400)return false;
    ctx.save();ctx.globalAlpha=options.opacity??1;
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
    ctx.fillStyle=options.color||'#ffffffcc';ctx.fill();
    ctx.strokeStyle='#00000066';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
    return true;
  }
  // Which face points up, assuming the phone is upright and fixed: camera -y is up.
  // score is 1 when the face points exactly up; below ~.5 the box sits on an edge.
  const GOLD='#e8b23a';
  function upFace(rotation) {
    let face=0,score=-9;
    bases.forEach(([n],k)=>{const y=rotation[1].reduce((s,x,i)=>s+x*n[i],0);if(-y>score){score=-y;face=k;}});
    return {face,score};
  }
  function hull(points) {
    const sorted=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const half=list=>{const out=[];for(const p of list){while(out.length>=2&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}return out;};
    const a=half(sorted), b=half(sorted.slice().reverse());a.pop();b.pop();return a.concat(b);
  }
  // Returns the FACE index (0=A..5=F) of the visible face containing (x,y), or -1.
  function hitFace(pose,x,y) {
    for(let i=0;i<faces.length;i++) {
      const pts=faces[i].map(v=>pose.points[v]);
      const area=pts.reduce((s,p,j)=>{const q=pts[(j+1)%4];return s+p.x*q.y-q.x*p.y;},0);
      if(area<=0)continue;
      if(pts.every((p,j)=>{const q=pts[(j+1)%4];return (q.x-p.x)*(y-p.y)-(q.y-p.y)*(x-p.x)>=0;})) return faceMarker[i];
    }
    return -1;
  }
  function highlight(ctx,pose,k) {
    const i=faceMarker.indexOf(k),pts=faces[i].map(v=>pose.points[v]);
    const area=pts.reduce((s,p,j)=>{const q=pts[(j+1)%4];return s+p.x*q.y-q.x*p.y;},0);
    if(area<=0)return;
    ctx.save();ctx.beginPath();pts.forEach((p,j)=>j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
    ctx.fillStyle='#fff8';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.stroke();ctx.restore();
  }
  // Draws a mesh in box coordinates: back faces culled, far polygons first (d grows with depth).
  // Light is fixed to the box, so shading turns with it.
  function drawMesh(ctx,pose,mesh,opacity) {
    const light=[.35,.8,-.5],norm=Math.hypot(...light),points=mesh.vertices.map(pose.project);
    if(points.some(p=>!p))return false;
    const list=[];
    mesh.polygons.forEach((poly,i)=>{
      const pts=poly.map(v=>points[v]);
      const area=pts.reduce((s,p,j)=>{const q=pts[(j+1)%pts.length];return s+p.x*q.y-q.x*p.y;},0);
      if(area<=0)return;
      const [a,b,c]=poly.map(v=>mesh.vertices[v]),u=b.map((x,k)=>x-a[k]),w=c.map((x,k)=>x-a[k]);
      const n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],len=Math.hypot(...n)||1;
      const shade=.55+.6*Math.max(0,dot(n,light)/len/norm);
      list.push({pts,layer:mesh.layers?.[mesh.parts[poly[0]]]??0,depth:pts.reduce((s,p)=>s+p.d,0)/pts.length,
        color:mesh.colors[mesh.materials[i]].map(x=>Math.min(255,Math.round(x*shade)))});
    });
    // Lower parts first (a plate before the button on it), then far to near inside each part.
    list.sort((p,q)=>p.layer-q.layer||q.depth-p.depth);
    ctx.save();ctx.globalAlpha=opacity;ctx.lineJoin='round';
    for(const {pts,color} of list){
      ctx.beginPath();pts.forEach((p,j)=>j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
      ctx.fillStyle=ctx.strokeStyle=`rgb(${color})`;ctx.lineWidth=.8;ctx.fill();ctx.stroke();
    }
    ctx.restore();return list;
  }
  // Places a 'base'-fitted mesh on face k (0=A..5=F): model +Y along the outward normal,
  // +X along the marker's right. width is relative to the face; parts listed in press sink by pressDepth.
  // Pressed parts are clamped to the top of the other parts: their buried portion would break depth sorting.
  function placeOnFace(mesh,k,width,press=[],pressDepth=0,inward=false) {
    const [outward,r]=bases[k],n=inward?outward.map(x=>-x):outward,z=cross(r,n);
    const top=Math.max(...mesh.vertices.filter((_,i)=>!press.includes(mesh.parts[i])).map(v=>v[1]));
    const vertices=mesh.vertices.map(([x,y,w],i)=>{const h=press.includes(mesh.parts[i])?Math.max(top,y-pressDepth):y;
      return [0,1,2].map(j=>outward[j]*.5+width*(x*r[j]+h*n[j]+w*z[j]));});
    return {...mesh,vertices};
  }
  // Point-in-polygon over polygons returned by drawMesh (front-facing ones only).
  function hitPolygons(list,x,y) {
    return !!list&&list.some(({pts})=>{let inside=false;
      for(let i=0,j=pts.length-1;i<pts.length;j=i++){const p=pts[i],q=pts[j];
        if((p.y>y)!==(q.y>y)&&x<(q.x-p.x)*(y-p.y)/(q.y-p.y)+p.x)inside=!inside;}
      return inside;});
  }
  const boxColors=['#253c58','#24364e','#234257','#5984a7','#345877','#3b627e'];
  const shade=(hex,f)=>`rgb(${[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*f))})`;
  const faceColor=(style,i)=>style==='color'?faceColors[faceMarker[i]]:style==='box'?boxColors[i]:'#1a1a1a';
  // options.colors overrides a single face (long press), options.gold overrides all of them.
  const shownColor=(style,i,options)=>options.gold?GOLD:options.colors?.[faceMarker[i]]??faceColor(style,i);
  // Swings face k open around its bottom edge (-u): points on the face rotate outward by angle.
  function openTransform(k,angle) {
    const [n,r,u]=bases[k],cos=Math.cos(angle),sin=Math.sin(angle);
    return p=>{const q=p.map((v,i)=>v-n[i]*.5),a=dot(q,r),h=dot(q,u)+.5,d=dot(q,n);
      return [0,1,2].map(i=>n[i]*.5+a*r[i]+(h*cos-.5)*u[i]+(h*sin+d)*n[i]);};
  }
  const transformMesh=(mesh,fn)=>({...mesh,vertices:mesh.vertices.map(fn)});
  // With one face open, the far walls' inner sides show through the hole, so they are drawn first.
  function drawOpen(ctx,pose,style,opacity,k,angle,options={}) {
    const path=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();};
    const color=i=>shownColor(style,i,options);
    const quads=faces.map((face,i)=>({i,pts:face.map(v=>pose.points[v])})).filter(({i})=>faceMarker[i]!==k)
      .map(q=>({...q,area:q.pts.reduce((s,p,j)=>{const t=q.pts[(j+1)%4];return s+p.x*t.y-t.x*p.y;},0)}));
    ctx.save();ctx.globalAlpha=opacity;ctx.lineJoin='round';
    for(const {i,pts,area} of quads) if(area<=0){path(pts);ctx.fillStyle=shade(color(i),.32);ctx.fill();
      ctx.strokeStyle=shade(color(i),.5);ctx.lineWidth=1.5;ctx.stroke();}
    // Anything standing inside the box sits between the far walls and the near walls.
    const inside=options.inside?drawMesh(ctx,pose,options.inside,opacity):null;
    for(const {i,pts,area} of quads) if(area>0){path(pts);ctx.fillStyle=color(i);ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      label(ctx,options,faceMarker[i],pts.reduce((c,p)=>({x:c.x+p.x/4,y:c.y+p.y/4}),{x:0,y:0}),Math.sqrt(area/2)*.35);}
    const lidIndex=faceMarker.indexOf(k),transform=openTransform(k,angle);
    const lid=faces[lidIndex].map(v=>pose.project(transform(vertices[v])));
    if(lid.every(Boolean)) {
      const area=lid.reduce((s,p,j)=>{const t=lid[(j+1)%4];return s+p.x*t.y-t.x*p.y;},0);
      path(lid);ctx.fillStyle=area>0?color(lidIndex):shade(color(lidIndex),.32);ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      if(area>0) label(ctx,options,k,lid.reduce((c,p)=>({x:c.x+p.x/4,y:c.y+p.y/4}),{x:0,y:0}),Math.sqrt(area/2)*.35);
    }
    ctx.restore();
    return inside;
  }
  // options: labels (face index -> text drawn on the face), gold (solved look).
  function label(ctx,options,k,center,size) {
    const text=options.labels?.[k]??(options.labels?null:String.fromCharCode(65+k));
    if(!text||size<8)return;
    ctx.font=`bold ${size*(text.length>1?.8:1.4)}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=options.gold?'#00000088':'#000a';ctx.fillText(text,center.x,center.y);
  }
  function draw(ctx,pose,style,opacity,options={}) {
    const path=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();};
    ctx.save();ctx.globalAlpha=opacity;
    if(style!=='color'){path(hull(pose.points));ctx.fillStyle='#000';ctx.fill();}
    if(style==='color') {
      faces.forEach((face,i)=>{
        const points=face.map(v=>pose.points[v]);
        const area=points.reduce((s,p,j)=>{const q=points[(j+1)%4];return s+p.x*q.y-q.x*p.y;},0);
        if(area<=0)return;
        const k=faceMarker[i],center=points.reduce((c,p)=>({x:c.x+p.x/4,y:c.y+p.y/4}),{x:0,y:0});
        path(points);ctx.fillStyle=shownColor(style,i,options);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        label(ctx,options,k,center,Math.sqrt(area/2)*.35);
      });
    }
    if(style==='box') {
      faces.forEach((face,i)=>{
        const points=face.map(v=>pose.points[v]);
        const area=points.reduce((s,p,j)=>{const q=points[(j+1)%4];return s+p.x*q.y-q.x*p.y;},0);
        if(area<=0)return;
        path(points);ctx.fillStyle=shownColor(style,i,options);ctx.fill();ctx.strokeStyle='#9fd8f3';ctx.lineWidth=2;ctx.stroke();
        label(ctx,options,faceMarker[i],points.reduce((c,p)=>({x:c.x+p.x/4,y:c.y+p.y/4}),{x:0,y:0}),Math.sqrt(Math.abs(area)/2)*.35);
      });
    }
    ctx.restore();
  }
  const api={estimate,draw,worldCorners,vertices,faces,faceColors,faceMarker,hitFace,highlight,drawMesh,placeOnFace,hitPolygons,drawOpen,openTransform,transformMesh,upFace,faceScreenAxes,drawArrow};
  if(typeof module!=='undefined')module.exports=api;else root.MockARBox=api;
})(globalThis);
