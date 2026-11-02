import AppKit
import SceneKit
import Metal
import simd

guard CommandLine.arguments.count >= 3 else { fatalError("Usage: render-native capture.json output.mp4") }
let input=CommandLine.arguments[1],output=CommandLine.arguments[2]
let data=try Data(contentsOf:URL(fileURLWithPath:input))
let doc=try JSONSerialization.jsonObject(with:data) as! [String:Any]
let width=doc["width"] as! Int,height=doc["height"] as! Int,fps=doc["fps"] as! Int
let takes=doc["takes"] as! [[String:Any]]
let renderSurfaces=doc["renderSurfaces"] as? [String:[String:Any]] ?? [:]
let cinematic=(doc["renderStyle"] as? String ?? "cinematic") != "light"
let editorial=doc["story"] != nil
let lightEditorial=(doc["story"] as? [String:Any])?["theme"] as? String == "editorial"
let storyEnabled=(doc["story"] as? [String:Any])?["enabled"] as? Bool != false
let title=doc["title"] as! String,experiment=doc["experiment"] as! String
let total=takes.reduce(0){$0+($1["frames"] as! [[String:Any]]).count}
func num(_ x:Any?,_ fallback:Double=0)->Double{(x as? NSNumber)?.doubleValue ?? fallback}
func vec(_ a:[Double])->SCNVector3{SCNVector3(a[0],a[1],a[2])}
func aimCamera(_ camera:SCNNode,_ target:SCNVector3){
 camera.look(at:target,up:SCNVector3(0,1,0),localFront:SCNVector3(0,0,-1))
}
let cameraDiagnosticPath=ProcessInfo.processInfo.environment["MATTER_CAMERA_DIAGNOSTICS"]
var cameraDiagnostics:[[String:Any]]=[]
func orientationXYZ(_ a:[Double])->SCNQuaternion{
 let c1=cos(a[0]/2),c2=cos(a[1]/2),c3=cos(a[2]/2),s1=sin(a[0]/2),s2=sin(a[1]/2),s3=sin(a[2]/2)
 return SCNQuaternion(s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3)
}
func color(_ hex:String)->NSColor{
 let s=hex.replacingOccurrences(of:"#",with:"");let v=Int(s,radix:16) ?? 0xddddcc
 return NSColor(srgbRed:CGFloat((v>>16)&255)/255,green:CGFloat((v>>8)&255)/255,blue:CGFloat(v&255)/255,alpha:1)
}
let palette:[String:String]=["wood":"#bf9262","ceramic":"#e4e3d6","metal":"#809a9d","rubber":"#ed744c","ice":"#7ccad7","cork":"#c3a168","jelly":"#9982d1","clay":"#d4866b","foam":"#a7c171","water":"#4eafdc","oil":"#ddb849","honey":"#db8e35"]
func bounded(_ value:Double,_ lower:Double,_ upper:Double)->Double{value.isFinite ? max(lower,min(upper,value)) : lower}
let thermalEmissionScale=bounded(Double(ProcessInfo.processInfo.environment["MATTER_THERMAL_EMISSION"] ?? "0.38") ?? 0.38,0,3.1)
struct StudioEnvironment{
 let id:String,background:String,floor:String,key:String,fill:String
 let exposure:Double,saturation:Double,roughness:Double
 let light:Bool
}
let studio:StudioEnvironment?={
 guard let settings=doc["environment"] as? [String:Any] else{return nil}
 let id=settings["id"] as? String ?? "studio",isGallery=id=="gallery",isArena=id=="arena"
 return StudioEnvironment(id:id,background:settings["background"] as? String ?? (isGallery ? "#e7e3db" : isArena ? "#13182d" : "#0d1019"),floor:settings["floor"] as? String ?? (isGallery ? "#d8d2c4" : isArena ? "#242d47" : "#1a2130"),key:settings["keyColor"] as? String ?? "#fff4e5",fill:settings["fillColor"] as? String ?? (isGallery ? "#e3e8ec" : "#d1d9e8"),exposure:bounded(num(settings["exposure"],isGallery ? -0.05 : 0.08),-1.5,1.5),saturation:bounded(num(settings["saturation"],1.06),0.6,1.5),roughness:bounded(num(settings["roughness"],isGallery ? 0.74 : 0.56),0.15,1),light:isGallery)
}()
func grain(_ x:Int,_ y:Int,_ seed:UInt32=17)->Double{
 var h=UInt32(truncatingIfNeeded:x)&*374761393 &+ UInt32(truncatingIfNeeded:y)&*668265263 &+ seed
 h=(h^(h>>13))&*1274126177;h=h^(h>>16)
 return Double(h)/Double(UInt32.max)
}
func coherent(_ x:Double,_ y:Double,_ seed:UInt32=17)->Double{
 let ix=Int(floor(x)),iy=Int(floor(y)),fx=x-Double(ix),fy=y-Double(iy),u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy)
 let a=grain(ix,iy,seed)*(1-u)+grain(ix+1,iy,seed)*u,b=grain(ix,iy+1,seed)*(1-u)+grain(ix+1,iy+1,seed)*u
 return a*(1-v)+b*v
}
func pixelImage(_ size:Int,_ pixel:(Int,Int)->SIMD4<Double>)->NSImage{
 let context=CGContext(data:nil,width:size,height:size,bitsPerComponent:8,bytesPerRow:size*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
 let bytes=context.data!.assumingMemoryBound(to:UInt8.self)
 for y in 0..<size{for x in 0..<size{let rgba=pixel(x,y),offset=(y*size+x)*4;for k in 0..<4{bytes[offset+k]=UInt8(bounded(rgba[k],0,1)*255)}}}
 return NSImage(cgImage:context.makeImage()!,size:NSSize(width:size,height:size))
}
struct FinishMaps{let diffuse:NSImage,roughness:NSImage,normal:NSImage}
var finishMaps:[String:FinishMaps]=[:]
func maps(_ finish:String,_ tint:String)->FinishMaps{
 let cacheKey=finish+"|"+tint;if let cached=finishMaps[cacheKey]{return cached}
 let size=finish=="ice-micro" ? 512 : 256,base=color(tint).usingColorSpace(.deviceRGB)!,rgb=SIMD3<Double>(Double(base.redComponent),Double(base.greenComponent),Double(base.blueComponent))
 var heights=[Double](repeating:0.5,count:size*size),brightness=[Double](repeating:1,count:size*size),roughness=[Double](repeating:0.5,count:size*size)
 for y in 0..<size{for x in 0..<size{
  let u=Double(x)/Double(size),v=Double(y)/Double(size),fine=grain(x,y)-0.5,broad=coherent(u*8,v*8)-0.5,k=y*size+x
  switch finish{
  case "wood","cork":
   let bend=(coherent(u*5,v*1.5,31)-0.5)*1.7
   let fibre=sin((u*22+bend)*Double.pi*2)*0.55+sin((u*165+bend+v*0.9)*Double.pi*2)*0.17
   heights[k]=0.5+fibre*0.027+fine*0.012;brightness[k]=0.97+fibre*0.115+broad*0.025;roughness[k]=0.65+fibre*0.07+fine*0.025
  case "metal":
   let brush=sin(u*Double.pi*2*93+coherent(u*3,v*0.6)*0.8)
   heights[k]=0.5+brush*0.009+fine*0.004;brightness[k]=0.99+brush*0.017+fine*0.012;roughness[k]=0.31+brush*0.05+fine*0.025
  case "rubber":
   heights[k]=0.5+fine*0.032+broad*0.008;brightness[k]=0.99+fine*0.025;roughness[k]=0.76+fine*0.07
  case "foam":
   let cx=Int(floor(u*42)),cy=Int(floor(v*42)),dx=u*42-Double(cx)-grain(cx,cy,71),dy=v*42-Double(cy)-grain(cx,cy,73),pore=exp(-(dx*dx+dy*dy)*85)
   heights[k]=0.5-pore*0.10+fine*0.027;brightness[k]=0.995-pore*0.10+fine*0.035;roughness[k]=0.94+fine*0.05
  case "fabric":
   let weave=sin(u*Double.pi*2*77)*sin(v*Double.pi*2*77)
   heights[k]=0.5+weave*0.025+fine*0.018;brightness[k]=0.98+weave*0.035+fine*0.035;roughness[k]=0.92+fine*0.05
  case "ice":
   let frost=coherent(u*19,v*19,87),vein=pow(max(0,sin((u*2.5+coherent(u*3,v*3))*Double.pi*2)),18)
   heights[k]=0.5+(frost-0.5)*0.055+vein*0.012;brightness[k]=1.035+(frost-0.5)*0.10;roughness[k]=0.35+frost*0.17
  case "ice-micro":
   // Static inclusions and frost describe the specimen surface, not impact
   // fractures. Coordinates stay fixed in world space while the channel melts.
   let cellX=Int(floor(u*30)),cellY=Int(floor(v*30)),dx=u*30-Double(cellX)-grain(cellX,cellY,111),dy=v*30-Double(cellY)-grain(cellX,cellY,113),bubble=grain(cellX,cellY,117)>0.72 ? exp(-(dx*dx+dy*dy)*190) : 0,cloud=coherent(u*7,v*7,123)
   heights[k]=0.5+fine*0.01+bubble*0.012;brightness[k]=0.94+cloud*0.10+bubble*0.22;roughness[k]=0.17+cloud*0.13+bubble*0.12
  case "skin":
   heights[k]=0.5+fine*0.011+broad*0.004;brightness[k]=0.995+fine*0.026+broad*0.016;roughness[k]=0.48+fine*0.045+broad*0.035
  case "clay":
   heights[k]=0.5+fine*0.018+broad*0.025;brightness[k]=0.98+fine*0.025+broad*0.035;roughness[k]=0.82+fine*0.045
  case "paint":
   heights[k]=0.5+fine*0.009;brightness[k]=0.995+fine*0.018;roughness[k]=0.49+fine*0.025
  default:
   heights[k]=0.5+fine*0.005;brightness[k]=0.995+fine*0.012;roughness[k]=finish=="jelly" ? 0.24+fine*0.015 : 0.32+fine*0.025
  }
 }}
 let diffuse=pixelImage(size){x,y in let value=rgb*brightness[y*size+x];return SIMD4<Double>(value.x,value.y,value.z,1)}
 let rough=pixelImage(size){x,y in let value=bounded(roughness[y*size+x],0.05,1);return SIMD4<Double>(value,value,value,1)}
 let normal=pixelImage(size){x,y in
  let dx=(heights[y*size+(x+1)%size]-heights[y*size+(x+size-1)%size])*4,dy=(heights[((y+1)%size)*size+x]-heights[((y+size-1)%size)*size+x])*4
  let n=simd_normalize(SIMD3<Double>(-dx,-dy,1));return SIMD4<Double>(n.x*0.5+0.5,n.y*0.5+0.5,n.z*0.5+0.5,1)
 }
 let result=FinishMaps(diffuse:diffuse,roughness:rough,normal:normal);finishMaps[cacheKey]=result;return result
}
func material(_ id:String,_ tint:String?=nil,_ requestedFinish:String?=nil)->SCNMaterial{
 let m=SCNMaterial();m.lightingModel = .physicallyBased;m.diffuse.contents=color(tint ?? palette[id] ?? "#ddddcc")
 m.roughness.contents=id=="metal" ? 0.22 : id=="jelly" ? 0.17 : id=="foam" ? 0.88 : id=="rubber" ? 0.30 : 0.48;m.metalness.contents=id=="metal" ? 0.72 : 0.0
 m.fresnelExponent=1.8
 if studio != nil{
  let finish=requestedFinish ?? id,texture=maps(finish,tint ?? palette[id] ?? "#ddddcc")
  m.diffuse.contents=texture.diffuse;m.roughness.contents=texture.roughness;m.normal.contents=texture.normal
  m.normal.intensity=finish=="foam" ? 0.27 : finish=="wood" || finish=="fabric" ? 0.22 : finish=="ice" ? 0.19 : 0.12
  for property in [m.diffuse,m.roughness,m.normal]{property.wrapS = .repeat;property.wrapT = .repeat;property.minificationFilter = .linear;property.magnificationFilter = .linear;property.mipFilter = .linear}
  m.metalness.contents=finish=="metal" ? 0.90 : 0.0;m.fresnelExponent=1.45
  m.clearCoat.contents=finish=="ceramic" ? 0.18 : finish=="skin" ? 0.08 : finish=="jelly" ? 0.18 : 0.0
  m.clearCoatRoughness.contents=finish=="ceramic" ? 0.18 : 0.32
  if finish=="ice"{m.metalness.contents=0.025;m.clearCoat.contents=0.08;m.clearCoatRoughness.contents=0.3}
  if finish=="foam" || finish=="fabric" || finish=="rubber"{m.specular.contents=NSColor(white:0.16,alpha:1)}
 }
 m.isDoubleSided=true;return m
}
func floats(_ value:Any?)->[Float]{
 guard let str=value as? String,let d=Data(base64Encoded:str) else{return []}
 return d.withUnsafeBytes{raw in (0..<(d.count/4)).map{Float(bitPattern:UInt32(littleEndian:raw.loadUnaligned(fromByteOffset:$0*4,as:UInt32.self)))}}
}
func mesh(_ positions:[Float],_ indices:[Int32]?,_ suppliedNormals:[Float]?=nil,_ suppliedUV:SCNGeometrySource?=nil)->SCNGeometry{
 let count=positions.count/3
 if count==0{return SCNGeometry()}
 var vertices=[SCNVector3]();vertices.reserveCapacity(count)
 for i in 0..<count{vertices.append(SCNVector3(positions[i*3],positions[i*3+1],positions[i*3+2]))}
 let ix=indices ?? Array(0..<Int32(count))
 var normals=[SIMD3<Float>](repeating:SIMD3<Float>(0,0,0),count:count)
 if let supplied=suppliedNormals,supplied.count==positions.count{for i in 0..<count{normals[i]=SIMD3<Float>(supplied[i*3],supplied[i*3+1],supplied[i*3+2])}}
 else if ix.count>=3{for i in stride(from:0,to:ix.count-2,by:3){let a=Int(ix[i]),b=Int(ix[i+1]),c=Int(ix[i+2]);if a>=count||b>=count||c>=count{continue};let pa=SIMD3<Float>(positions[a*3],positions[a*3+1],positions[a*3+2]),pb=SIMD3<Float>(positions[b*3],positions[b*3+1],positions[b*3+2]),pc=SIMD3<Float>(positions[c*3],positions[c*3+1],positions[c*3+2]);let n=simd_cross(pb-pa,pc-pa);normals[a]+=n;normals[b]+=n;normals[c]+=n}}
 let ns=normals.map{n -> SCNVector3 in let l=simd_length(n);let nn=l>1e-9 ? n/l : SIMD3<Float>(0,1,0);return SCNVector3(nn.x,nn.y,nn.z)}
 var uv:[CGPoint]=[];uv.reserveCapacity(count)
 for i in 0..<count{
  let p=vertices[i],normal=ns[i],nx=abs(normal.x),ny=abs(normal.y),nz=abs(normal.z)
  if ny>nx && ny>nz{uv.append(CGPoint(x:Double(p.x)*2,y:Double(p.z)*2))}
  else if nx>nz{uv.append(CGPoint(x:Double(p.z)*2,y:Double(p.y)*2))}
  else{uv.append(CGPoint(x:Double(p.x)*2,y:Double(p.y)*2))}
 }
 let textureSource=suppliedUV ?? SCNGeometrySource(textureCoordinates:uv)
 return SCNGeometry(sources:[SCNGeometrySource(vertices:vertices),SCNGeometrySource(normals:ns),textureSource],elements:[SCNGeometryElement(indices:ix,primitiveType:.triangles)])
}
struct IceNormalKey:Hashable{let x:Int32,y:Int32,z:Int32}
func cutawayNormals(_ positions:[Float],_ indices:[Int32],_ radius:Float)->[Float]{
 let count=positions.count/3;var normals=[SIMD3<Float>](repeating:.zero,count:count),curved=[Bool](repeating:false,count:count),welded:[IceNormalKey:SIMD3<Float>]=[:]
 func point(_ i:Int)->SIMD3<Float>{SIMD3<Float>(positions[i*3],positions[i*3+1],positions[i*3+2])}
 func key(_ p:SIMD3<Float>)->IceNormalKey{IceNormalKey(x:Int32((p.x*1e6).rounded()),y:Int32((p.y*1e6).rounded()),z:Int32((p.z*1e6).rounded()))}
 for t in stride(from:0,to:indices.count-2,by:3){
  let ids=[Int(indices[t]),Int(indices[t+1]),Int(indices[t+2])];if ids.contains(where:{$0<0 || $0>=count}){continue}
  let p=ids.map{point($0)},normal=simd_cross(p[1]-p[0],p[2]-p[0]);if simd_length_squared(normal)<1e-18{continue}
  let front=p.allSatisfy{abs($0.z)<1e-6},cavity = !front && p.allSatisfy{hypot($0.x,$0.z)<=radius*1.002+1e-6}
  for i in 0..<3{normals[ids[i]]+=normal;if cavity{curved[ids[i]]=true;welded[key(p[i]),default:.zero]+=normal}}
 }
 var result=[Float]();result.reserveCapacity(positions.count)
 for i in 0..<count{let n=curved[i] ? welded[key(point(i))] ?? normals[i] : normals[i],length=simd_length(n),unit=length>1e-9 ? n/length : SIMD3<Float>(0,1,0);result.append(contentsOf:[unit.x,unit.y,unit.z])}
 return result
}
func finishForPart(_ part:[String:Any],_ id:String,_ tint:String?)->String{
 if let explicit=part["finish"] as? String{if ["brushed","polished","dark"].contains(explicit){return "metal"};if explicit=="powder"{return "paint"};return explicit}
 if id=="wood"{
  // Rigid fruit shares the mechanical wood preset. Smooth coloured ellipsoids
  // get a skin finish; physics material names do not force decorative grain.
  if part["shape"] as? String == "ellipsoid"{return "skin"}
  let c=color(part["color"] as? String ?? tint ?? palette[id]!).usingColorSpace(.deviceRGB)!
  var hue:CGFloat=0,saturation:CGFloat=0,brightness:CGFloat=0,alpha:CGFloat=0;c.getHue(&hue,saturation:&saturation,brightness:&brightness,alpha:&alpha)
  if saturation>0.35 && (hue>0.17 || hue<0.025){return "paint"}
 }
 return id
}
func partNode(_ p:[String:Any],_ id:String,_ tint:String?)->SCNNode{
 let shape=p["shape"] as? String ?? "box",d=p["d"] as! [Double]
 let g:SCNGeometry
 switch shape{
 case "sphere":let s=SCNSphere(radius:d[0]);s.segmentCount=48;g=s
 case "ellipsoid":let s=SCNSphere(radius:1);s.segmentCount=32;g=s
 case "cylinder":let s=SCNCylinder(radius:d[0],height:d[1]);s.radialSegmentCount=32;g=s
 case "cone":let s=SCNCone(topRadius:0,bottomRadius:d[0],height:d[1]);s.radialSegmentCount=32;g=s
 case "torus":g=SCNTorus(ringRadius:d[0],pipeRadius:d[1])
 case "icosa":let s=SCNSphere(radius:d[0]);s.segmentCount=8;s.isGeodesic=true;g=s
 default:let bevel=min(0.035,d.min()! * 0.14);let s=SCNBox(width:d[0],height:d[1],length:d[2],chamferRadius:bevel);s.chamferSegmentCount=3;g=s
 }
 let finish=material(id,p["color"] as? String ?? tint,finishForPart(p,id,tint))
 if let roughness=p["roughness"] as? Double{finish.roughness.contents=bounded(roughness,0,1)}
 if let metalness=p["metalness"] as? Double{finish.metalness.contents=bounded(metalness,0,1)}
 g.materials=[finish]
 let n=SCNNode(geometry:g);n.position=vec(p["p"] as? [Double] ?? [0,0,0]);n.orientation=orientationXYZ(p["r"] as? [Double] ?? [0,0,0]);n.castsShadow=true;if shape=="ellipsoid"{n.scale=vec(d)};return n
}
func moonTexture()->NSImage {
 let w=768,h=384,space=CGColorSpaceCreateDeviceRGB()
 let ctx=CGContext(data:nil,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
 let ptr=ctx.data!.assumingMemoryBound(to:UInt8.self)
 var craters:[(Double,Double,Double)]=[]
 for i in 0..<75{let x=Double((i*127+39)%w),y=Double((i*79+17)%h),r=Double(4+(i*37)%26);craters.append((x,y,r))}
 for y in 0..<h{for x in 0..<w{
  let grain=Double((x*73856093 ^ y*19349663) & 255)/255-0.5
  var c=0.57+0.009*grain+0.035*sin(Double(x)*0.018)*sin(Double(y)*0.026)+0.025*sin(Double(x)*0.043+Double(y)*0.072)
  for (cx,cy,r) in craters{let dx=Double(x)-cx,dy=Double(y)-cy,dist=hypot(dx,dy)/r;if dist<1.18{c-=0.10*pow(max(0,1-dist),0.6);c+=0.035*exp(-pow((dist-0.98)*9,2));c+=0.06*max(0,1-dist)*dx/r}}
  c=max(0.12,min(0.85,c));let k=(y*w+x)*4;ptr[k]=UInt8(c*224);ptr[k+1]=UInt8(c*235);ptr[k+2]=UInt8(c*242);ptr[k+3]=255
 }}
 return NSImage(cgImage:ctx.makeImage()!,size:NSSize(width:w,height:h))
}
func environment()->NSImage{
 let w=studio == nil ? 512 : 768,h=studio == nil ? 256 : 384,space=CGColorSpaceCreateDeviceRGB()
 let ctx=CGContext(data:nil,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
 if let style=studio{
  // Neutral studio reflection cards. Small bright sources shape a metal edge;
  // a fully white hemisphere would wash every painted object into pastel.
  let dark=style.light ? color("#a39c90") : color("#1c2230"),bright=style.light ? color("#e2ded4") : color("#616979")
  let gradient=CGGradient(colorsSpace:space,colors:[dark.cgColor,bright.cgColor] as CFArray,locations:[0,1])!
  ctx.drawLinearGradient(gradient,start:CGPoint(x:0,y:0),end:CGPoint(x:0,y:h),options:[])
  ctx.setFillColor(color("#fff9ef").cgColor);ctx.fill(CGRect(x:72,y:207,width:112,height:133))
  ctx.setFillColor(color("#f3f6fb").cgColor);ctx.fill(CGRect(x:553,y:168,width:43,height:175))
  ctx.setFillColor(color("#d5dbe2").cgColor);ctx.fill(CGRect(x:282,y:323,width:228,height:28))
  return NSImage(cgImage:ctx.makeImage()!,size:NSSize(width:w,height:h))
 }
 // Preserve the original environment for captures without an environment spec.
 ctx.setFillColor(color("#a6b4af").cgColor);ctx.fill(CGRect(x:0,y:0,width:w,height:h))
 ctx.setFillColor(color("#eeede4").cgColor);ctx.fill(CGRect(x:0,y:h/2,width:w,height:h/2))
 ctx.setFillColor(color("#ffffff").cgColor);ctx.fill(CGRect(x:80,y:145,width:100,height:70));ctx.fill(CGRect(x:360,y:140,width:65,height:90))
 return NSImage(cgImage:ctx.makeImage()!,size:NSSize(width:w,height:h))
}
func compositionBounds(_ take:[String:Any])->(SCNVector3,Double){
 let entities=take["entities"] as? [[String:Any]] ?? [],frames=take["frames"] as? [[String:Any]] ?? []
 var radii:[Double]=[]
 for entity in entities{
  var radius=0.1
  for part in entity["parts"] as? [[String:Any]] ?? []{
   let d=part["d"] as? [Double] ?? [1],p=part["p"] as? [Double] ?? [0,0,0],shape=part["shape"] as? String ?? "box";var r=0.5
   if shape=="sphere" || shape=="icosa"{r=d[0]}
   else if shape=="torus"{r=d[0]+d[1]}
   else if shape=="ellipsoid"{r=sqrt(d.reduce(0){$0+$1*$1})}
   else if shape=="cylinder" || shape=="cone"{r=hypot(d[0],d[1]/2)}
   else{r=sqrt(d.reduce(0){$0+$1*$1})/2}
   radius=max(radius,r+sqrt(p.reduce(0){$0+$1*$1}))
  }
  radii.append(radius*num(entity["scale"],1))
 }
 var low=SIMD3<Double>(repeating:Double.infinity),high=SIMD3<Double>(repeating:-Double.infinity)
 for index in stride(from:0,to:frames.count,by:max(1,frames.count/24)){
  let poses=floats(frames[index]["poses"])
  for i in 0..<entities.count where i*7+2<poses.count{
   let p=SIMD3<Double>(Double(poses[i*7]),Double(poses[i*7+1]),Double(poses[i*7+2]))
   if !p.x.isFinite || !p.y.isFinite || !p.z.isFinite || p.y < -20 || simd_length(p)>500{continue}
   let r=SIMD3<Double>(repeating:radii[i]);low=simd_min(low,p-r);high=simd_max(high,p+r)
  }
 }
 if !low.x.isFinite{return(SCNVector3(0,1,0),8)}
 let center=(low+high)*0.5,extent=high-low
 return(SCNVector3(center.x,center.y,center.z),bounded(max(extent.x,max(extent.y,extent.z)),0.8,80))
}
func studioLighting(_ scene:SCNScene,_ center:SCNVector3,_ size:Double,_ style:StudioEnvironment){
 let span=max(3,size),target=center
 func position(_ x:Double,_ y:Double,_ z:Double)->SCNVector3{SCNVector3(Double(center.x)+x*span,Double(center.y)+y*span,Double(center.z)+z*span)}
 func add(_ type:SCNLight.LightType,_ position:SCNVector3,_ intensity:CGFloat,_ tint:String,_ shadow:Bool,_ area:SIMD3<Float>?=nil){
  let node=SCNNode(),light=SCNLight();light.type=type;light.intensity=intensity;light.color=color(tint);light.castsShadow=shadow
  if let extents=area{light.areaType = .rectangle;light.areaExtents=extents}
  if shadow{
   light.shadowMode = .forward;light.shadowColor=NSColor(white:0,alpha:style.light ? 0.42 : 0.53);light.shadowMapSize=CGSize(width:width>=2160 ? 4096 : 2048,height:width>=2160 ? 4096 : 2048)
   light.shadowSampleCount=32;light.shadowRadius=3;light.shadowBias=0.25;light.orthographicScale=max(2.0,span*0.72);light.zNear=0.05;light.zFar=max(40,span*6);light.maximumShadowDistance=max(60,span*8);light.automaticallyAdjustsShadowProjection=false
  }
  node.light=light;node.position=position;node.look(at:target);scene.rootNode.addChildNode(node)
 }
 add(.directional,position(-0.8,1.5,1.0),style.light ? 750 : 1100,style.key,true)
 add(.area,position(-0.6,1.0,0.7),style.light ? 700 : 1500,style.key,false,SIMD3<Float>(Float(span*0.6),Float(span*0.75),0))
 add(.area,position(0.9,0.5,0.35),style.light ? 160 : 220,style.fill,false,SIMD3<Float>(Float(span*0.7),Float(span*0.9),0))
 add(.directional,position(0.4,0.7,-1.0),style.light ? 100 : 350,"#edf2fa",false)
 let ambient=SCNNode();ambient.light=SCNLight();ambient.light!.type = .ambient;ambient.light!.color=color(style.light ? "#f0e9dc" : "#d5dbe5");ambient.light!.intensity=style.light ? 20 : 15;scene.rootNode.addChildNode(ambient)
}
func heatedSteel(_ temperature:Double,_ node:SCNNode,_ lightNode:SCNNode,_ radius:Double){
 let t=bounded(temperature,0,2500),glow=bounded((t-450)/700,0,1)
 let emission=NSColor(srgbRed:1,green:0.06+0.44*pow(glow,1.4),blue:0.012+0.10*glow*glow,alpha:1)
 for child in node.childNodes{if let m=child.geometry?.firstMaterial{
  // Keep incandescence below the reflected key light so the sphere retains
  // a readable highlight, shaded limb and metallic volume at high temperature.
  m.clearCoat.contents=0
  m.emission.contents=emission;m.emission.intensity=thermalEmissionScale*pow(glow,1.7)
 }}
 // An unshadowed point source inside the carved mesh produces false caustics
 // on its individual strips. Incandescence is carried by the steel surface;
 // the existing studio key and reflection cards supply its shape.
 lightNode.position=node.position;lightNode.light?.intensity=0
}
func cutawayIce(_ front:Bool)->SCNMaterial{
 let m=SCNMaterial();m.lightingModel = .physicallyBased
 let texture=maps("ice-micro",front ? "#9ccbe2" : "#4d9cbd")
 m.diffuse.contents=texture.diffuse;m.roughness.contents=texture.roughness;m.roughness.intensity=front ? 1.1 : 0.8
 m.normal.contents=texture.normal;m.normal.intensity=0.045;m.metalness.contents=0
 for property in [m.diffuse,m.roughness,m.normal]{property.wrapS = .repeat;property.wrapT = .repeat;property.minificationFilter = .linear;property.magnificationFilter = .linear;property.mipFilter = .linear}
 m.specular.contents=NSColor(white:front ? 0.32 : 0.38,alpha:1)
 m.clearCoat.contents=front ? 0.08 : 0.12;m.clearCoatRoughness.contents=0.26
 m.fresnelExponent=1.8;m.isDoubleSided=true
 return m
}
guard let device=MTLCreateSystemDefaultDevice() else{fatalError("Metal GPU unavailable")}
let renderer=SCNRenderer(device:device,options:nil)
let env=environment()
let lunarTexture=moonTexture()
let ffmpeg=Process();let paths=(ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator:":").map{String($0)+"/ffmpeg"}+["/opt/homebrew/bin/ffmpeg","/usr/local/bin/ffmpeg"]
guard let ffpath=paths.first(where:{FileManager.default.isExecutableFile(atPath:$0)}) else{fatalError("ffmpeg is required")}
ffmpeg.executableURL=URL(fileURLWithPath:ffpath)
let hardware=width>=2160 && ProcessInfo.processInfo.environment["MATTER_LAB_ENCODER"] != "software"
let encoder=hardware ? ["-c:v","h264_videotoolbox","-allow_sw","0","-b:v","45000k"] : ["-c:v","libx264","-preset","veryfast","-crf","18"]
ffmpeg.arguments=["-hide_banner","-loglevel","error","-f","rawvideo","-pixel_format","rgba","-video_size","\(width)x\(height)","-framerate","\(fps)","-i","pipe:0","-an"]+encoder+["-pix_fmt","yuv420p","-movflags","+faststart","-y",output]
let pipe=Pipe();ffmpeg.standardInput=pipe;ffmpeg.standardOutput=FileHandle.nullDevice;ffmpeg.standardError=FileHandle.standardError;try ffmpeg.run()
let bytesPerRow=width*4,buffer=UnsafeMutableRawPointer.allocate(byteCount:height*bytesPerRow,alignment:64)
defer{buffer.deallocate()}
let bitmap=CGContext(data:buffer,width:width,height:height,bitsPerComponent:8,bytesPerRow:bytesPerRow,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
let scale=CGFloat(width)/1080
let ink=color(cinematic || experiment=="orbit" ? "#eff5f4" : "#273c39"),muted=color(cinematic || experiment=="orbit" ? "#a5bdcc" : "#7e9185"),accent=color("#f59a68")
func text(_ str:String,x:CGFloat,y:CGFloat,size:CGFloat=26,tint:NSColor?=nil,weight:NSFont.Weight = .regular,width:CGFloat=950){
 let paragraph=NSMutableParagraphStyle();paragraph.lineSpacing=5*scale
 let attrs:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:size*scale,weight:weight),.foregroundColor:tint ?? ink,.paragraphStyle:paragraph]
 (str as NSString).draw(in:CGRect(x:x*scale,y:CGFloat(height)-(y+size*2.1)*scale,width:width*scale,height:size*2.6*scale),withAttributes:attrs)
}
func overlay(_ take:[String:Any],_ n:Int,_ frame:[String:Any],_ f:Int,_ count:Int){
 if !storyEnabled{return}
 if let art=frame["editorial"] as? [String:Any]{editorialOverlay(take,n,frame,f,count,art);return}
 let previous=NSGraphicsContext.current;NSGraphicsContext.current=NSGraphicsContext(cgContext:bitmap,flipped:false)
 if cinematic{bitmap.setFillColor(color("#0e1c29").cgColor);bitmap.fill(CGRect(x:0,y:CGFloat(height)-340*scale,width:CGFloat(width),height:340*scale));bitmap.fill(CGRect(x:0,y:0,width:CGFloat(width),height:350*scale))}
 text("MATTER / LAB",x:65,y:70,size:21,tint:muted,weight:.semibold)
 let headlines=["thermal":"1000 °C против льда","soft":"Что запомнит вмятину?","mechanism":"Что подбросит выше?","orbit":"Один кирпич. Четыре скорости.","flow":"Как вязкость меняет поток"]
 text(headlines[experiment] ?? title,x:62,y:135,size:47,weight:.medium)
 text(String(format:"%02d",n+1)+" / "+String(format:"%02d",takes.count)+"     "+(take["label"] as? String ?? ""),x:65,y:219,size:25,tint:accent,weight:.semibold)
 text(take["detail"] as? String ?? "",x:65,y:265,size:24,tint:muted)
 bitmap.setFillColor(color("#cfdbce").cgColor);bitmap.fill(CGRect(x:65*scale,y:CGFloat(height)-331*scale,width:950*scale,height:scale))
 let stats=frame["stats"] as? [String:Any] ?? [:]
 var primary="ГРАВИТАЦИЯ · КОНТАКТ · ПЕРЕДАЧА ИМПУЛЬСА",secondary="Одинаковая сцена. Меняем один параметр и сравниваем."
 if experiment=="soft"{primary="ПОСЛЕ СНЯТИЯ НАГРУЗКИ";secondary=n<2 ? "Материал стремится восстановить исходную форму" : "Пластилин сохраняет остаточную деформацию"}
 if experiment=="mechanism"{primary=String(format:"МАКСИМАЛЬНАЯ ВЫСОТА ГРУЗА %.2f М",num(stats["apex"],1.25));secondary="Оранжевый груз падает. Голубой — подбрасывается рычагом."}
 if experiment=="flow"{primary="ЧЕМ ВЯЗЧЕ МАТЕРИАЛ, ТЕМ МЕДЛЕННЕЕ ПОТОК";secondary="Модель частиц · подготовленный желоб и резервуар"}
 if let thermal=frame["thermal"] as? [String:Any]{primary=String(format:"ГЛУБИНА %0.1f СМ    ·    ШАР %0.0f °C",num(thermal["depth"])*100,num(thermal["temperature"]));secondary=String(format:"Модельное время %.0f с · оценка теплообмена",num(thermal["elapsed"]))}
 if let orbit=frame["orbit"] as? [String:Any]{primary=String(format:"ВЫСОТА %0.0f КМ    ·    СКОРОСТЬ %0.0f М/С",num(orbit["altitude"])/1000,num(orbit["speed"]));secondary=String(format:"Время опыта %.0f мин · вакуум · размер снаряда увеличен",num(orbit["elapsed"])/60)}
 if let directed=frame["camera"] as? [String:Any]{
  let stage=directed["stage"] as? String ?? "action"
  if experiment=="soft"{primary=directed["caption"] as? String ?? primary;secondary=String(format:"Высота материала %.1f см",num(stats["softHeight"],1.4)*100)}
  if experiment=="mechanism"{primary=directed["caption"] as? String ?? primary;secondary=String(format:"Подъём голубого: %.2f м · падение оранжевого: %.1f м",max(0,num(stats["apex"],1.25)-1.25),num((take["settings"] as? [String:Any])?["dropHeight"],2.4))}
  if experiment=="flow"{primary=directed["caption"] as? String ?? primary;secondary=String(format:"В резервуаре %.0f из %.0f частиц",num(stats["collected"]),num(stats["particles"]))}
  if stage=="result"{secondary=primary;primary=directed["outcome"] as? String ?? primary}
  if directed["marker"] as? Bool == true,let point=directed["markerPosition"] as? [Double],let target=directed["target"] as? [Double]{
   let halfHeight=num(directed["scale"],8),aspect=Double(width)/Double(height)
   let px=CGFloat((point[0]-target[0])/(2*halfHeight*aspect)+0.5)*CGFloat(width),py=CGFloat((point[1]-target[1])/(2*halfHeight)+0.5)*CGFloat(height)
   if px>20*scale && px<CGFloat(width)-20*scale && py>370*scale && py<CGFloat(height)-360*scale{
    bitmap.setStrokeColor(accent.cgColor);bitmap.setLineWidth(2*scale);bitmap.strokeEllipse(in:CGRect(x:px-15*scale,y:py-15*scale,width:30*scale,height:30*scale))
    let lx=min(CGFloat(width)-220*scale,max(45*scale,px+30*scale)),ly=min(CGFloat(height)-410*scale,max(385*scale,py+35*scale));bitmap.move(to:CGPoint(x:px+12*scale,y:py+12*scale));bitmap.addLine(to:CGPoint(x:lx,y:ly));bitmap.strokePath()
    let attrs:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:20*scale,weight:.semibold),.foregroundColor:ink];((directed["label"] as? String ?? "Снаряд") as NSString).draw(at:CGPoint(x:lx+6*scale,y:ly),withAttributes:attrs)
   }
  }
 }
 text(primary,x:65,y:1578,size:34,tint:ink,weight:.semibold)
 text(secondary,x:65,y:1672,size:24,tint:muted)
 let step:CGFloat=950/CGFloat(max(takes.count,1));for i in 0..<takes.count{
  bitmap.setFillColor((i==n ? accent : color("#c7d3c5")).cgColor)
  bitmap.fill(CGRect(x:(65+CGFloat(i)*step)*scale,y:CGFloat(height)-1740*scale,width:(step-9)*scale,height:4*scale))
 }
 let sec=(Double(n*count+f))/Double(fps)
 text(String(format:"%02d:%02d",Int(sec)/60,Int(sec)%60),x:65,y:1772,size:20,tint:muted)
 text("EXPERIMENT SERIES",x:750,y:1772,size:17,tint:muted,width:270)
 NSGraphicsContext.current=previous
}
func captionFont(_ size:CGFloat,_ weight:NSFont.Weight,_ condensed:Bool=false)->NSFont{
 let font=NSFont.systemFont(ofSize:size*scale,weight:weight)
 return condensed ? NSFont(descriptor:font.fontDescriptor.withSymbolicTraits(.condensed),size:size*scale) ?? font : font
}
func artText(_ str:String,_ top:CGFloat,_ size:CGFloat,_ tint:NSColor,_ weight:NSFont.Weight = .semibold,_ maxHeight:CGFloat=210,_ x:CGFloat=80,_ maxWidth:CGFloat=900,_ condensed:Bool=false){
 let paragraph=NSMutableParagraphStyle();paragraph.lineSpacing=0;paragraph.lineBreakMode = .byWordWrapping
 let attrs:[NSAttributedString.Key:Any]=[.font:captionFont(size,weight,condensed),.foregroundColor:tint,.paragraphStyle:paragraph,.kern:-size*scale*0.045]
 (str as NSString).draw(in:CGRect(x:x*scale,y:CGFloat(height)-(top+maxHeight)*scale,width:maxWidth*scale,height:maxHeight*scale),withAttributes:attrs)
}
struct HeadlineFit{let size:CGFloat,condensed:Bool}
var headlineFits:[String:HeadlineFit]=[:]
func headlineFit(_ str:String,_ maximum:CGFloat,_ width:CGFloat,_ kerning:CGFloat,_ weight:NSFont.Weight)->HeadlineFit{
 let key="\(str)|\(maximum)|\(width)|\(kerning)|\(weight.rawValue)";if let cached=headlineFits[key]{return cached}
 for condensed in [false,true]{for size in stride(from:Int(maximum),through:42,by:-1){
  let value=CGFloat(size),font=captionFont(value,weight,condensed),paragraph=NSMutableParagraphStyle();paragraph.lineSpacing=0;paragraph.lineBreakMode = .byWordWrapping
  let attrs:[NSAttributedString.Key:Any]=[.font:font,.paragraphStyle:paragraph,.kern:-value*scale*kerning]
  let bounds=(str as NSString).boundingRect(with:CGSize(width:width*scale,height:10000*scale),options:[.usesLineFragmentOrigin,.usesFontLeading],attributes:attrs)
  if bounds.height<=NSLayoutManager().defaultLineHeight(for:font)*2+0.5*scale{let fit=HeadlineFit(size:value,condensed:condensed);headlineFits[key]=fit;return fit}
 }}
 let fit=HeadlineFit(size:42,condensed:true);headlineFits[key]=fit;return fit
}
func projectPoint(_ point:[Double],_ frame:[String:Any])->CGPoint?{
 guard let camera=frame["camera"] as? [String:Any],let position=camera["position"] as? [Double],let target=camera["target"] as? [Double] else{return nil}
 let eye=SIMD3<Double>(position),focus=SIMD3<Double>(target),p=SIMD3<Double>(point),forward=simd_normalize(focus-eye)
 let right=simd_normalize(simd_cross(forward,SIMD3<Double>(0,1,0))),up=simd_cross(right,forward),delta=p-eye,depth=simd_dot(delta,forward),tangent=tan(num(camera["fov"],40)*Double.pi/360)
 if depth<=0{return nil};let x=0.5+simd_dot(delta,right)/(2*depth*tangent*Double(width)/Double(height)),y=0.5+simd_dot(delta,up)/(2*depth*tangent)
 return CGPoint(x:x*Double(width),y:y*Double(height))
}
func sceneAnnotationOverlay(_ frame:[String:Any]){
 guard let annotations=frame["annotations"] as? [[String:Any]],!annotations.isEmpty else{return}
 let previous=NSGraphicsContext.current;NSGraphicsContext.current=NSGraphicsContext(cgContext:bitmap,flipped:false)
 defer{NSGraphicsContext.current=previous}
 for a in annotations{
  guard let position=a["position"] as? [Double],let label=a["text"] as? String,let point=projectPoint(position,frame),point.x>=0,point.y>=0,point.x<=CGFloat(width),point.y<=CGFloat(height) else{continue}
  let font=NSFont.systemFont(ofSize:CGFloat(num(a["size"],24))*scale,weight:.semibold),attrs:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:color(a["color"] as? String ?? "#ffffff")],size=(label as NSString).size(withAttributes:attrs),pad=7*scale,rect=CGRect(x:point.x-size.width/2-pad,y:point.y-size.height/2-3*scale,width:size.width+pad*2,height:size.height+6*scale)
  bitmap.addPath(CGPath(roundedRect:rect,cornerWidth:4*scale,cornerHeight:4*scale,transform:nil));bitmap.setFillColor(color("#101923").withAlphaComponent(0.74).cgColor);bitmap.fillPath();(label as NSString).draw(in:rect.insetBy(dx:pad,dy:3*scale),withAttributes:attrs)
 }
}
// The capture's graphicsLayout is resolved by src/graphics-style.js. The
// fallback below keeps older captures usable without scene-specific styling.
let graphicsDiagnosticPath=ProcessInfo.processInfo.environment["MATTER_GRAPHICS_DIAGNOSTICS"]
var graphicsDiagnostics:[[String:Any]]=[]
var graphicsDiagnosticKeys=Set<String>()
func graphicsOverlay(_ art:[String:Any])->(NSColor,NSColor,NSColor,Bool){
 let config=(art["graphics"] as? [String:Any]) ?? ((doc["story"] as? [String:Any])?["graphics"] as? [String:Any]) ?? [:]
 let resolved=art["graphicsLayout"] as? [String:Any] ?? [:]
 let preset=config["preset"] as? String ?? "studio",position=config["position"] as? String ?? "top",centered=config["align"] as? String == "center",factor=bounded(num(config["scale"],1),0.8,1.5),labelFactor=bounded(num(config["labelScale"],1),0.85,1.6),metricFactor=bounded(num(config["metricScale"],1),0.8,1.5)
 func token(_ key:String,_ fallback:Double)->CGFloat{CGFloat(num(resolved[key],fallback))}
 let tone=config["tone"] as? String ?? "auto",darkInk=tone=="dark" || tone=="auto" && (studio?.light == true || art["theme"] as? String == "editorial")
 let ink=color(darkInk ? "#162B3A" : "#F7FAFC"),subtle=color(darkInk ? "#425D6B" : "#C5D2DB"),accentColor=color(art["accent"] as? String ?? "#D8FF5F"),shade=color(darkInk ? "#F1F5F6" : "#071321")
 let backdrop=config["backdrop"] as? String ?? "auto",soft=backdrop=="soft" || backdrop=="auto" && !darkInk
 let x=token("left",84),maxWidth=token("width",900),maximum=token("headlineSize",(preset=="poster" ? 98 : preset=="technical" ? 72 : 84)*factor),minimum=token("minimumSize",60*factor),leading=token("lineHeight",preset=="poster" ? 1.03 : preset=="technical" ? 1.14 : 1.08),tracking=token("tracking",preset=="poster" ? -0.04 : preset=="technical" ? -0.025 : -0.035)
 let headlineWeight:NSFont.Weight=preset=="poster" ? .heavy : preset=="technical" ? .semibold : .bold
 let labelSize=token("labelSize",36*factor*labelFactor),labelGap=token("labelGap",20),ruleGap=token("ruleGap",22),anchor=token("anchor",position=="bottom" ? 1 : position=="center" ? 0.5 : 0),anchorY=token("anchorY",position=="bottom" ? 1656 : position=="center" ? 940 : 144)
 func clean(_ value:Any?)->String{(value as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines)}
 func attrs(_ size:CGFloat,_ tint:NSColor,_ weight:NSFont.Weight,_ spacing:CGFloat,_ lineHeight:CGFloat,_ aligned:Bool=false,_ digits:Bool=false)->[NSAttributedString.Key:Any]{
  let paragraph=NSMutableParagraphStyle();paragraph.lineSpacing=0;paragraph.lineBreakMode = .byWordWrapping;paragraph.minimumLineHeight=size*lineHeight*scale;paragraph.maximumLineHeight=size*lineHeight*scale;paragraph.alignment=aligned ? .center : .left
  let font=digits ? NSFont.monospacedDigitSystemFont(ofSize:size*scale,weight:weight) : NSFont.systemFont(ofSize:size*scale,weight:weight)
  return[.font:font,.foregroundColor:tint,.paragraphStyle:paragraph,.kern:size*scale*spacing]
 }
 func extent(_ str:String,_ size:CGFloat,_ weight:NSFont.Weight,_ spacing:CGFloat,_ lineHeight:CGFloat)->CGSize{
  guard !str.isEmpty else{return .zero}
  let bounds=(str as NSString).boundingRect(with:CGSize(width:maxWidth*scale,height:10000*scale),options:[.usesLineFragmentOrigin,.usesFontLeading],attributes:attrs(size,ink,weight,spacing,lineHeight,centered))
  return CGSize(width:ceil(bounds.width/scale),height:ceil(bounds.height/scale))
 }
 func draw(_ str:String,_ top:CGFloat,_ size:CGFloat,_ tint:NSColor,_ weight:NSFont.Weight,_ spacing:CGFloat,_ lineHeight:CGFloat,_ textHeight:CGFloat,_ aligned:Bool?=nil){
  guard !str.isEmpty else{return}
  (str as NSString).draw(with:CGRect(x:x*scale,y:CGFloat(height)-(top+textHeight)*scale,width:maxWidth*scale,height:textHeight*scale),options:[.usesLineFragmentOrigin,.usesFontLeading],attributes:attrs(size,tint,weight,spacing,lineHeight,aligned ?? centered))
 }
 func backdropBlock(_ top:CGFloat,_ bottom:CGFloat,_ lane:String,_ opacity:CGFloat,_ fade:CGFloat=110){
  guard soft,bottom>top else{return}
  let padding:CGFloat=32,start:CGFloat=lane=="top" ? 0 : max(0,top-padding-fade),end:CGFloat=lane=="bottom" ? 1920 : min(1920,bottom+padding+fade),span=max(1,end-start)
  let holdStart:CGFloat=lane=="top" ? start : max(start,top-padding),holdEnd:CGFloat=lane=="bottom" ? end : min(end,bottom+padding)
  let clear=shade.withAlphaComponent(0).cgColor,tint=shade.withAlphaComponent(opacity).cgColor
  if let gradient=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:[clear,tint,tint,clear] as CFArray,locations:[0,(holdStart-start)/span,(holdEnd-start)/span,1]){
   bitmap.drawLinearGradient(gradient,start:CGPoint(x:0,y:CGFloat(height)-start*scale),end:CGPoint(x:0,y:CGFloat(height)-end*scale),options:[])
  }
 }
 let phase=art["phase"] as? String ?? "action",headline=clean(phase=="hook" ? art["hook"] : phase=="setup" ? art["question"] : art["caption"]),label=clean(art["takeLabel"]),opacity=CGFloat(bounded(num(art["captionOpacity"],1),0,1))
 var size=maximum,headlineBounds=CGSize.zero
 if !headline.isEmpty{
  var found=false
  for lines in [2,3]{
   for candidate in stride(from:Int(maximum.rounded(.down)),through:Int(minimum.rounded(.up)),by:-1){
    let measured=extent(headline,CGFloat(candidate),headlineWeight,tracking,leading)
    if measured.height<=CGFloat(candidate)*leading*CGFloat(lines)+1{size=CGFloat(candidate);headlineBounds=measured;found=true;break}
   }
   if found{break}
  }
  if !found{size=minimum;headlineBounds=extent(headline,size,headlineWeight,tracking,leading)}
 }
 let labelBounds=extent(label,labelSize,.medium,-0.01,1.3),hasTitle = !headline.isEmpty || !label.isEmpty
 let ruleHeight:CGFloat=preset=="technical" ? 1.5 : preset=="poster" ? 6 : 5,sideRule=preset=="poster" && !centered
 let titleInset:CGFloat=sideRule ? 0 : ruleHeight+ruleGap,labelInset:CGFloat=headline.isEmpty || label.isEmpty ? 0 : labelGap
 let blockHeight=hasTitle ? titleInset+headlineBounds.height+labelInset+labelBounds.height : 0,captionOffset=CGFloat(bounded(num(art["captionOffsetY"]),0,32)),titleTop=anchorY-blockHeight*anchor+captionOffset
 let metric=clean(art["metric"]),summary=(art["summary"] as? [[String:Any]] ?? []).count>0,showMetric=art["hideMetric"] as? Bool != true && !metric.isEmpty && !summary
 let unit=clean(art["metricUnit"]),metricLabel=clean(art["metricLabel"]),valueSize=token("metricSize",112*factor*metricFactor)*(metric.count>8 ? 0.8 : 1),unitSize=token("metricUnitSize",34*factor*metricFactor),metricLabelSize=token("metricLabelSize",27*factor*metricFactor)
 let metricLabelBounds=extent(metricLabel,metricLabelSize,.medium,-0.01,1.25)
 let metricLine=NSMutableAttributedString(string:metric,attributes:attrs(valueSize,ink,.semibold,-0.035,1.06,false,true))
 if !unit.isEmpty{metricLine.append(NSAttributedString(string:" "+unit,attributes:attrs(unitSize,subtle,.medium,-0.015,1.06)))}
 let metricBounds=metricLine.boundingRect(with:CGSize(width:maxWidth*scale,height:10000*scale),options:[.usesLineFragmentOrigin,.usesFontLeading]),metricRowHeight=ceil(metricBounds.height/scale)
 let metricGap:CGFloat=metricLabel.isEmpty ? 0 : 12,metricHeight=metricLabelBounds.height+metricGap+metricRowHeight,metricAnchor=token("metricAnchor",position=="bottom" ? 0 : 1),metricAnchorY=token("metricAnchorY",position=="bottom" ? 144 : 1656),metricTop=metricAnchorY-metricHeight*metricAnchor
 if hasTitle{
  bitmap.saveGState();bitmap.setAlpha(opacity)
  backdropBlock(titleTop,titleTop+blockHeight,position,position=="center" ? 0.65 : 0.88)
  bitmap.setFillColor(accentColor.cgColor)
  if sideRule{bitmap.fill(CGRect(x:(x-24)*scale,y:CGFloat(height)-(titleTop+76)*scale,width:6*scale,height:76*scale))}
  else{let ruleWidth:CGFloat=preset=="technical" ? maxWidth : preset=="poster" ? 72 : 48,ruleX=centered ? x+(maxWidth-ruleWidth)/2 : x;bitmap.fill(CGRect(x:ruleX*scale,y:CGFloat(height)-(titleTop+ruleHeight)*scale,width:ruleWidth*scale,height:ruleHeight*scale))}
  draw(headline,titleTop+titleInset,size,ink,headlineWeight,tracking,leading,headlineBounds.height)
  draw(label,titleTop+titleInset+headlineBounds.height+labelInset,labelSize,subtle,.medium,-0.01,1.3,labelBounds.height)
  bitmap.restoreGState()
 }
 if showMetric{
  backdropBlock(metricTop,metricTop+metricHeight,metricAnchor==0 ? "top" : "bottom",0.78,100)
  draw(metricLabel,metricTop,metricLabelSize,subtle,.medium,-0.01,1.25,metricLabelBounds.height,false)
  metricLine.draw(with:CGRect(x:x*scale,y:CGFloat(height)-(metricTop+metricHeight)*scale,width:maxWidth*scale,height:metricRowHeight*scale),options:[.usesLineFragmentOrigin,.usesFontLeading])
 }
 if config["showCounter"] as? Bool == true{
  let value=String(format:"%02d / %02d",Int(num(art["takeIndex"]))+1,Int(num(art["takeCount"],1))),paragraph=NSMutableParagraphStyle();paragraph.alignment = .right
  let attributes:[NSAttributedString.Key:Any]=[.font:NSFont.monospacedDigitSystemFont(ofSize:26*scale,weight:.medium),.foregroundColor:subtle,.paragraphStyle:paragraph]
  (value as NSString).draw(in:CGRect(x:x*scale,y:CGFloat(height)-128*scale,width:maxWidth*scale,height:36*scale),withAttributes:attributes)
 }
 if graphicsDiagnosticPath != nil{
  let key="\(preset)|\(position)|\(centered)|\(maximum)|\(labelSize)|\(valueSize)|\(opacity)|\(captionOffset)|\(headline)|\(label)|\(metric)"
  if !graphicsDiagnosticKeys.contains(key){graphicsDiagnosticKeys.insert(key);graphicsDiagnostics.append(["preset":preset,"position":position,"headline":headline,"condition":label,"headlineSize":size,"minimumSize":minimum,"labelSize":labelSize,"metricSize":valueSize,"captionOpacity":opacity,"captionOffsetY":captionOffset,"headlineHeight":headlineBounds.height,"preferredTwoLines":headlineBounds.height<=size*leading*2+1,"withinThreeLines":headlineBounds.height<=size*leading*3+1,"titleRect":[x,titleTop,maxWidth,blockHeight],"metricRect":showMetric ? [x,metricTop,maxWidth,metricHeight] : [],"titleSafe": !hasTitle || titleTop>=112 && titleTop+blockHeight<=1660,"metricSafe": !showMetric || metricTop>=112 && metricTop+metricHeight<=1660])}
 }
 return(ink,subtle,accentColor,darkInk)
}

func editorialOverlay(_ take:[String:Any],_ n:Int,_ frame:[String:Any],_ f:Int,_ count:Int,_ art:[String:Any]){
 if art["enabled"] as? Bool == false || !storyEnabled{return}
 let previous=NSGraphicsContext.current;NSGraphicsContext.current=NSGraphicsContext(cgContext:bitmap,flipped:false)
 let (white,subtle,accentColor,light)=graphicsOverlay(art)
 if let summary=art["summary"] as? [[String:Any]],!summary.isEmpty{
  let rect=CGRect(x:80*scale,y:CGFloat(height)-1290*scale,width:900*scale,height:640*scale),path=CGPath(roundedRect:rect,cornerWidth:22*scale,cornerHeight:22*scale,transform:nil)
  bitmap.addPath(path);bitmap.setFillColor((light ? color("#f0f3ea") : color("#0a1822")).withAlphaComponent(0.96).cgColor);bitmap.fillPath();bitmap.addPath(path);bitmap.setStrokeColor(white.withAlphaComponent(0.18).cgColor);bitmap.setLineWidth(scale);bitmap.strokePath()
  for (i,row) in summary.prefix(4).enumerated(){
   let top=CGFloat(650+i*160),value=row["metric"] as? String ?? "—"
   artText(row["label"] as? String ?? "",top+29,30,white,.semibold,60,110,480)
   artText(String((row["outcome"] as? String ?? "").prefix(42)),top+91,25,subtle,.regular,62,110,500)
   artText(value,top+17,value.count>5 ? 58 : 72,accentColor,.bold,100,700,250)
   artText(row["unit"] as? String ?? "",top+107,25,subtle,.medium,40,700,250)
   if i<3{bitmap.setFillColor(white.withAlphaComponent(0.09).cgColor);bitmap.fill(CGRect(x:110*scale,y:CGFloat(height)-(top+160)*scale,width:840*scale,height:scale))}
  }
 }
 if ((art["graphics"] as? [String:Any]) ?? ((doc["story"] as? [String:Any])?["graphics"] as? [String:Any]) ?? [:])["showProgress"] as? Bool == true{
 let step:CGFloat=900/CGFloat(max(takes.count,1)),progress=num(art["progress"])
 for i in 0..<takes.count{
  bitmap.setFillColor(white.withAlphaComponent(0.12).cgColor);bitmap.fill(CGRect(x:(80+CGFloat(i)*step)*scale,y:CGFloat(height)-1736*scale,width:(step-12)*scale,height:5*scale))
  if i<=n{bitmap.setFillColor(accentColor.cgColor);bitmap.fill(CGRect(x:(80+CGFloat(i)*step)*scale,y:CGFloat(height)-1736*scale,width:(step-12)*scale*CGFloat(i==n ? progress : 1),height:5*scale))}
 }
 }
 if art["summary"] == nil,let fx=art["effects"] as? [String:Any],num(fx["eventPulse"])>0,let ev=frame["event"] as? [String:Any],let point=ev["position"] as? [Double]{
  let pulse=num(fx["eventPulse"]),r=CGFloat(25+80*(1-pulse))*scale
  if let screen=projectPoint(point,frame){bitmap.setStrokeColor(accentColor.withAlphaComponent(pulse*0.75).cgColor);bitmap.setLineWidth(3*scale);bitmap.strokeEllipse(in:CGRect(x:screen.x-r,y:screen.y-r,width:r*2,height:r*2))}
 }
 if art["summary"] == nil,let fx=art["effects"] as? [String:Any],fx["heroOutline"] as? Bool == true,let p=frame["heroPosition"] as? [Double],let bounds=frame["heroBounds"] as? [Double],let point=projectPoint(p,frame),let edge=projectPoint([p[0]+bounds[0]/2,p[1],p[2]],frame),abs(edge.x-point.x)<25*scale{
  let label=String((art["heroName"] as? String ?? "Предмет").prefix(28));let attrs:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:27*scale,weight:.semibold),.foregroundColor:white]
  let textWidth=(label as NSString).size(withAttributes:attrs).width
  let r=CGFloat(18)*scale,lx=min(CGFloat(width)-88*scale-textWidth,max(80*scale,point.x+40*scale)),ly=min(CGFloat(height)-640*scale,max(550*scale,point.y+50*scale))
  bitmap.setStrokeColor(accentColor.withAlphaComponent(0.9).cgColor);bitmap.setLineWidth(2*scale);bitmap.strokeEllipse(in:CGRect(x:point.x-r,y:point.y-r,width:2*r,height:2*r));bitmap.move(to:CGPoint(x:point.x+r,y:point.y+r));bitmap.addLine(to:CGPoint(x:lx,y:ly));bitmap.strokePath()
  (label as NSString).draw(at:CGPoint(x:lx+8*scale,y:ly),withAttributes:attrs)
 }
 NSGraphicsContext.current=previous
}
var completed=0
for (takeIndex,take) in takes.enumerated(){
 let takeExperiment=take["experiment"] as? String ?? (take["settings"] as? [String:Any])?["experiment"] as? String ?? experiment
 let scene=SCNScene();scene.background.contents=color(studio?.background ?? (lightEditorial ? "#eaede6" : editorial ? "#06121c" : cinematic || takeExperiment=="orbit" ? "#102333" : "#e5e8df"))
 scene.lightingEnvironment.contents=env;scene.lightingEnvironment.intensity=studio != nil ? (studio!.light ? 0.30 : 0.24) : editorial ? 0.60 : 0.75
 let (sceneCenter,sceneSize)=compositionBounds(take)
 var nodes:[SCNNode]=[]
 for entity in take["entities"] as! [[String:Any]]{
  let root=SCNNode();let id=entity["material"] as? String ?? "ceramic"
  if let surfaceId=entity["surface"] as? String,let surface=renderSurfaces[surfaceId],let positions=surface["positions"] as? [Double],let indices=surface["indices"] as? [Int],!positions.isEmpty,!indices.isEmpty{
   let geometry=mesh(positions.map{Float($0)},indices.map{Int32($0)});geometry.materials=[material(id,entity["color"] as? String ?? surface["color"] as? String,surface["finish"] as? String)]
   let skin=SCNNode(geometry:geometry);skin.castsShadow=true;root.addChildNode(skin)
   for p in surface["details"] as? [[String:Any]] ?? []{root.addChildNode(partNode(p,id,entity["color"] as? String))}
  }else{for p in entity["parts"] as! [[String:Any]]{root.addChildNode(partNode(p,id,entity["color"] as? String))}}
  if entity["id"] as? String == "planet"{root.childNodes.first?.geometry?.firstMaterial?.diffuse.contents=lunarTexture;root.childNodes.first?.geometry?.firstMaterial?.roughness.contents=0.9}
  // Per-object art direction is independent of its physical material and parts.
  // Applying after construction also covers continuous skins and their details.
  if let appearance=entity["appearance"] as? [String:Any]{
   root.enumerateChildNodes{node,_ in
    for mat in node.geometry?.materials ?? []{
     if let tint=appearance["color"] as? String{mat.diffuse.contents=color(tint)}
     if let roughness=appearance["roughness"] as? Double{mat.roughness.contents=bounded(roughness,0,1)}
     if let metalness=appearance["metalness"] as? Double{mat.metalness.contents=bounded(metalness,0,1)}
    }
   }
  }
  let sc=num(entity["scale"],1);root.scale=SCNVector3(sc,sc,sc);scene.rootNode.addChildNode(root);nodes.append(root)
 }
 var meshNodes:[String:SCNNode]=[:],meshIndices:[String:[Int32]]=[:],meshMaterials:[String:SCNMaterial]=[:],meshKinds:[String:String]=[:],restUV:[String:SCNGeometrySource]=[:],iceFaces:[String:SCNMaterial]=[:],meshCutPlanes:[String:([Double],[Double])]=[:]
 for m in take["meshes"] as! [[String:Any]]{
  let id=m["id"] as! String,node=SCNNode(),kind=m["material"] as? String ?? "jelly",mat=material(kind,m["color"] as? String)
  if let appearance=m["appearance"] as? [String:Any]{
   if let roughness=appearance["roughness"] as? Double{mat.roughness.contents=bounded(roughness,0,1)}
   if let metalness=appearance["metalness"] as? Double{mat.metalness.contents=bounded(metalness,0,1)}
   if let coat=appearance["clearcoat"] as? Double{mat.clearCoat.contents=bounded(coat,0,1)}
  }
  meshIndices[id]=(m["indices"] as! [Int]).map{Int32($0)};meshMaterials[id]=mat;meshKinds[id]=kind;meshNodes[id]=node
  if let plane=m["cutPlane"] as? [String:[Double]],let point=plane["point"],let normal=plane["normal"],point.count==3,normal.count==3{meshCutPlanes[id]=(point,normal)}
  if (takeExperiment=="thermal" || m["kind"] as? String == "penetration-cutaway") && kind=="ice"{meshMaterials[id]=cutawayIce(false);iceFaces[id]=cutawayIce(true)}
  else if studio != nil && kind=="ice"{let cut=material("ice","#d5edf0");cut.roughness.contents=0.64;cut.normal.intensity=0.14;cut.clearCoat.contents=0;iceFaces[id]=cut}
  scene.rootNode.addChildNode(node)
 }
 let fluidNode=SCNNode();scene.rootNode.addChildNode(fluidNode)
 let referenceNode=SCNNode(),trailNode=SCNNode();scene.rootNode.addChildNode(referenceNode);scene.rootNode.addChildNode(trailNode)
 let storyAccent=(doc["story"] as? [String:Any])?["accent"] as? String ?? "#D8FF5F"
 if let reference=take["reference"] as? [String:Any],let bounds=reference["bounds"] as? [Double],let p=reference["position"] as? [Double]{
  let box=SCNBox(width:bounds[0],height:bounds[1],length:bounds[2],chamferRadius:0);let m=SCNMaterial();m.lightingModel = .constant;m.diffuse.contents=color(storyAccent);m.fillMode = .lines;m.transparency=0.38;m.writesToDepthBuffer=false;box.materials=[m];referenceNode.geometry=box;referenceNode.position=vec(p)
  if let q=reference["quaternion"] as? [Double]{referenceNode.orientation=SCNQuaternion(q[0],q[1],q[2],q[3])}
 }
 var trailPoints:[SCNVector3]=[],lastSourceTime:Double = -1
 var particleNodes:[SCNNode]=[]
 let particleGeometry=SCNSphere(radius:0.068);particleGeometry.segmentCount=16;particleGeometry.materials=[material("water","#3eafe1")]
 if takeExperiment != "orbit" {
  let floor=SCNNode(geometry:SCNPlane(width:2000,height:2000));floor.eulerAngles.x = -.pi/2;floor.position.y = studio == nil ? -0.055 : -0.031
  let fm=material("ceramic",studio?.floor ?? (lightEditorial ? "#d6ddd8" : editorial ? "#0b1926" : cinematic ? "#1c3447" : "#e5e8df"),"paint")
  fm.roughness.contents=studio?.roughness ?? (editorial ? 0.35 : 0.7);fm.clearCoat.contents=0;fm.lightingModel = studio != nil || cinematic ? .physicallyBased : .constant
  if studio != nil{fm.diffuse.contentsTransform=SCNMatrix4MakeScale(250,250,1);fm.normal.contentsTransform=SCNMatrix4MakeScale(250,250,1);fm.normal.intensity=0.035}
  floor.geometry!.materials=[fm];floor.castsShadow=false;scene.rootNode.addChildNode(floor)
 }
 func light(_ pos:SCNVector3,_ intensity:CGFloat,_ tint:String,_ shadow:Bool){let n=SCNNode();let l=SCNLight();l.type = .directional;l.intensity=intensity;l.color=color(tint);l.castsShadow=shadow;if shadow{l.shadowMode = .forward;l.shadowColor=NSColor(white:0.12,alpha:0.30);l.shadowMapSize=CGSize(width:2048,height:2048);l.shadowSampleCount=16;l.shadowRadius=4;l.orthographicScale=18;l.maximumShadowDistance=60};n.light=l;n.position=pos;n.look(at:SCNVector3Zero);scene.rootNode.addChildNode(n)}
 if let style=studio{studioLighting(scene,sceneCenter,sceneSize,style)}
 else{
  light(SCNVector3(-8,14,10),editorial ? 1250 : 1050,editorial ? "#f4f7ff" : "#fff4df",true);light(SCNVector3(8,7,-5),editorial ? 700 : 350,editorial ? "#74b9ee" : "#e1efff",false)
  let ambient=SCNNode();ambient.light=SCNLight();ambient.light!.type = .ambient;ambient.light!.color=color("#dfe8e1");ambient.light!.intensity=editorial ? 70 : 260;scene.rootNode.addChildNode(ambient)
 }
 let thermalLight=SCNNode();thermalLight.light=SCNLight();thermalLight.light!.type = .omni;thermalLight.light!.intensity=0;thermalLight.light!.castsShadow=false;thermalLight.light!.attenuationStartDistance=0.02;thermalLight.light!.attenuationEndDistance=0.45;thermalLight.light!.attenuationFalloffExponent=2;scene.rootNode.addChildNode(thermalLight)
 let camera=SCNNode();let lens=SCNCamera();lens.usesOrthographicProjection=true
 let scales:[String:Double]=["impact":6.4,"cascade":8.0,"mechanism":6.1,"soft":2.8,"flow":6.6,"thermal":0.96,"orbit":8.8]
 lens.orthographicScale=scales[takeExperiment] ?? 8;lens.zNear=0.01;lens.zFar=300
 lens.wantsHDR=true;lens.wantsExposureAdaptation=false;lens.exposureOffset = editorial ? -0.2 : -0.45;lens.bloomIntensity=0.10;lens.bloomThreshold=1.7
 if editorial{lens.saturation=1.15;lens.contrast=1.08;lens.vignettingIntensity=0.35;lens.vignettingPower=1.4}
 lens.screenSpaceAmbientOcclusionIntensity=0.8;lens.screenSpaceAmbientOcclusionRadius=0.8;lens.screenSpaceAmbientOcclusionBias=0.035
 if let style=studio{lens.exposureOffset=style.exposure;lens.saturation=style.saturation;lens.contrast=1.06;lens.vignettingIntensity=0;lens.vignettingPower=0;lens.bloomIntensity=0.045;lens.bloomThreshold=2.0;lens.screenSpaceAmbientOcclusionIntensity=0.82;lens.screenSpaceAmbientOcclusionRadius=bounded(sceneSize*0.025,0.065,0.24);lens.screenSpaceAmbientOcclusionBias=0.014}
 if !storyEnabled{lens.vignettingIntensity=0;lens.vignettingPower=0}
 camera.camera=lens;let views=doc["views"] as? [Double] ?? [8,6,12];camera.position=vec(views);aimCamera(camera,vec(doc["target"] as? [Double] ?? [0,1,0]));scene.rootNode.addChildNode(camera)
 let contextSpec=take["contextView"] as? [String:Any]
 let contextCamera=SCNNode();let contextLens=lens.copy() as! SCNCamera;contextLens.usesOrthographicProjection=false;contextLens.projectionDirection = .vertical;contextLens.fieldOfView=num(contextSpec?["fov"],40);contextCamera.camera=contextLens
 if let position=contextSpec?["position"] as? [Double],let target=contextSpec?["target"] as? [Double]{contextCamera.position=vec(position);aimCamera(contextCamera,vec(target));scene.rootNode.addChildNode(contextCamera)}
 renderer.scene=scene;renderer.pointOfView=camera
 let frames=take["frames"] as! [[String:Any]]
 for (f,frame) in frames.enumerated(){autoreleasepool{
  let poses=floats(frame["poses"])
  SCNTransaction.begin();SCNTransaction.animationDuration=0
  let art=frame["editorial"] as? [String:Any] ?? [:],showGraphics=storyEnabled && art["enabled"] as? Bool != false
  let changed=Set(frame["measuredChanges"] as? [String] ?? []),showMeasured=showGraphics && art["theme"] as? String != "minimal" && art["metricUnit"] as? String == "предметов",entityDescriptions=take["entities"] as! [[String:Any]]
  for i in 0..<nodes.count{let offset=i*7;if offset+6<poses.count{nodes[i].position=SCNVector3(poses[offset],poses[offset+1],poses[offset+2]);nodes[i].orientation=SCNQuaternion(poses[offset+3],poses[offset+4],poses[offset+5],poses[offset+6])};for child in nodes[i].childNodes{child.geometry?.firstMaterial?.emission.contents=showMeasured&&changed.contains(entityDescriptions[i]["id"] as? String ?? "") ? color(storyAccent) : NSColor.black;child.geometry?.firstMaterial?.emission.intensity=0.35}}
  for (id,value) in frame["vertices"] as? [String:Any] ?? [:]{if let n=meshNodes[id]{
   let positions=floats(value),smoothNormals=takeExperiment=="thermal" && meshKinds[id]=="ice" && meshIndices[id] != nil ? cutawayNormals(positions,meshIndices[id]!,Float(num((frame["thermal"] as? [String:Any])?["radius"],0.04))) : nil
   var g=mesh(positions,meshIndices[id],smoothNormals,restUV[id]);g.materials=[meshMaterials[id]!]
   if ["jelly","clay","foam"].contains(meshKinds[id] ?? ""),restUV[id]==nil{restUV[id]=g.sources(for:.texcoord).first}
   if let cut=iceFaces[id],let ix=meshIndices[id]{
    func faceDistance(_ offset:Int)->Double{guard let plane=meshCutPlanes[id] else{return Double(positions[offset+2])};return (0..<3).reduce(0.0){$0+(Double(positions[offset+$1])-plane.0[$1])*plane.1[$1]}}
    var front:[Int32]=[],outer:[Int32]=[]
    for i in stride(from:0,to:ix.count-2,by:3){let a=Int(ix[i])*3,b=Int(ix[i+1])*3,c=Int(ix[i+2])*3;if a+2<positions.count && b+2<positions.count && c+2<positions.count{if abs(faceDistance(a))+abs(faceDistance(b))+abs(faceDistance(c))<0.00001{front.append(contentsOf:ix[i...i+2])}else{outer.append(contentsOf:ix[i...i+2])}}}
    if !front.isEmpty{let sources=g.sources(for:.vertex)+g.sources(for:.normal)+g.sources(for:.texcoord);g=SCNGeometry(sources:sources,elements:[SCNGeometryElement(indices:outer,primitiveType:.triangles),SCNGeometryElement(indices:front,primitiveType:.triangles)]);g.materials=[meshMaterials[id]!,cut]}
   }
   n.geometry=g
  }}
  let fx=showGraphics ? art["effects"] as? [String:Any] ?? [:] : [:]
  referenceNode.isHidden=fx["reference"] as? Bool != true
  let sourceTime=num(frame["sourceTime"])
  if sourceTime<lastSourceTime{trailPoints=[]};lastSourceTime=sourceTime
  if fx["trail"] as? Bool == true,let p=frame["heroPosition"] as? [Double]{
   let current=vec(p);if trailPoints.isEmpty || simd_distance(SIMD3<Float>(Float(current.x),Float(current.y),Float(current.z)),SIMD3<Float>(Float(trailPoints.last!.x),Float(trailPoints.last!.y),Float(trailPoints.last!.z)))>0.03{trailPoints.append(current)}
   if trailPoints.count>100{trailPoints.removeFirst()}
   if trailPoints.count>1{var indices:[Int32]=[];for i in 1..<trailPoints.count{indices.append(Int32(i-1));indices.append(Int32(i))};let g=SCNGeometry(sources:[SCNGeometrySource(vertices:trailPoints)],elements:[SCNGeometryElement(indices:indices,primitiveType:.line)]);let m=SCNMaterial();m.lightingModel = .constant;m.diffuse.contents=color(storyAccent);m.transparency=0.55;g.materials=[m];trailNode.geometry=g}
  }else{trailNode.geometry=nil}
  if let thermal=frame["thermal"] as? [String:Any]{for(i,e)in entityDescriptions.enumerated() where e["id"] as? String == "hot-ball"{heatedSteel(num(thermal["temperature"]),nodes[i],thermalLight,num(thermal["radius"],0.04))}}
  if let state=frame["penetration"] as? [String:Any],let projectileId=state["projectileId"] as? String{for(i,e)in entityDescriptions.enumerated() where e["id"] as? String == projectileId{heatedSteel(num(state["temperature"]),nodes[i],thermalLight,num(state["radius"],0.004))}}
  if let fluid=frame["fluid"] as? [String:Any]{let verts=floats(fluid["vertices"]),normals=floats(fluid["normals"]);let g=mesh(verts,nil,normals);g.materials=[material("water",fluid["color"] as? String)];fluidNode.geometry=g;fluidNode.position=SCNVector3(0,2,0);fluidNode.scale=SCNVector3(10,10,10)}
  if let particleData=frame["fluidParticles"]{let pp=floats(particleData);while particleNodes.count<pp.count/3{let node=SCNNode(geometry:particleGeometry);node.castsShadow=true;scene.rootNode.addChildNode(node);particleNodes.append(node)};particleGeometry.firstMaterial!.diffuse.contents=color(frame["fluidColor"] as? String ?? "#3eafe1");for i in 0..<particleNodes.count{particleNodes[i].isHidden=i>=pp.count/3;if i<pp.count/3{particleNodes[i].position=SCNVector3(pp[i*3],pp[i*3+1],pp[i*3+2])}}}
  if let directed=frame["camera"] as? [String:Any],let position=directed["position"] as? [Double],let target=directed["target"] as? [Double]{
   lens.usesOrthographicProjection=false;lens.projectionDirection = .vertical;lens.fieldOfView=num(directed["fov"],40);camera.position=vec(position);aimCamera(camera,vec(target))
   if cameraDiagnosticPath != nil{
    let view=simd_inverse(camera.simdWorldTransform),tanHalf=tan(lens.fieldOfView*Double.pi/360)
    func projectWorldX(_ x:Double)->SIMD2<Double>{let q=view*SIMD4<Float>(Float(x),Float(target[1]),Float(target[2]),1),depth = -Double(q.z);return SIMD2<Double>(Double(q.x)/depth/tanHalf/(Double(width)/Double(height))*Double(width)/2,Double(q.y)/depth/tanHalf*Double(height)/2)}
    let a=projectWorldX(target[0]-1),b=projectWorldX(target[0]+1),delta=b-a
    cameraDiagnostics.append(["take":takeIndex,"frame":f,"time":Double(f)/Double(fps),"worldX_deltaY_px":delta.y,"worldX_angle_deg":atan2(delta.y,delta.x)*180/Double.pi,"position":position,"target":target])
   }
  }else{
   lens.usesOrthographicProjection=true
   let phase=Double(f)/Double(max(1,frames.count-1)),push=(doc["cameraMode"] as? String == "free" ? 0.0 : 0.16*sin(Double.pi*phase))
   lens.orthographicScale=(scales[takeExperiment] ?? 8)*(1-push)
   if takeExperiment != "orbit"{let a=(doc["cameraMode"] as? String == "free" ? 0.0 : 0.10)*sin(phase*Double.pi*1.4),px=views[0]*cos(a)+views[2]*sin(a),pz=views[2]*cos(a)-views[0]*sin(a);camera.position=SCNVector3(px,views[1],pz);aimCamera(camera,vec(doc["target"] as? [Double] ?? [0,1,0]))}
   if takeExperiment=="orbit",let orbit=frame["orbit"] as? [String:Any],num(orbit["altitude"])>3000000,let object=nodes.last{let p=object.position;let center=SCNVector3(p.x*0.38,p.y*0.38,0);lens.orthographicScale=max(8.8,max(abs(p.y)*0.65,abs(p.x)*0.95));camera.position=SCNVector3(center.x,center.y,20);aimCamera(camera,center)}
  }
  SCNTransaction.commit()
  let image=renderer.snapshot(atTime:Double(completed)/Double(fps),with:CGSize(width:width,height:height),antialiasingMode:.multisampling4X)
  guard let cg=image.cgImage(forProposedRect:nil,context:nil,hints:nil) else{fatalError("Empty render")}
  bitmap.draw(cg,in:CGRect(x:0,y:0,width:width,height:height))
  if let context=contextSpec,context["enabled"] as? Bool == true{
   let ratio=bounded(num(context["size"],0.35),0.2,0.48),w=CGFloat(width)*ratio,h=CGFloat(height)*ratio,margin=CGFloat(width)*0.035,corner=context["corner"] as? String ?? "bottom-right",rect=CGRect(x:corner.hasSuffix("right") ? CGFloat(width)-margin-w : margin,y:corner.hasPrefix("top") ? CGFloat(height)-margin-h : margin,width:w,height:h)
   renderer.pointOfView=contextCamera
   let inset=renderer.snapshot(atTime:Double(completed)/Double(fps),with:CGSize(width:ceil(w),height:ceil(h)),antialiasingMode:.multisampling4X)
   renderer.pointOfView=camera
   if let insetCG=inset.cgImage(forProposedRect:nil,context:nil,hints:nil){
    let path=CGPath(roundedRect:rect,cornerWidth:10*scale,cornerHeight:10*scale,transform:nil);bitmap.saveGState();bitmap.addPath(path);bitmap.clip();bitmap.draw(insetCG,in:rect);bitmap.restoreGState();bitmap.addPath(path);bitmap.setLineWidth(2*scale);bitmap.setStrokeColor(NSColor(white:0.9,alpha:0.5).cgColor);bitmap.strokePath()
    if let label=context["label"] as? String,!label.isEmpty{let previous=NSGraphicsContext.current;NSGraphicsContext.current=NSGraphicsContext(cgContext:bitmap,flipped:false);text(label,x:rect.minX/scale+12,y:(CGFloat(height)-rect.maxY)/scale+8,size:22,tint:color("#183044"),weight:.semibold,width:w/scale-24);NSGraphicsContext.current=previous}
   }
  }
  sceneAnnotationOverlay(frame)
  overlay(take,takeIndex,frame,f,frames.count)
  pipe.fileHandleForWriting.write(Data(bytesNoCopy:buffer,count:height*bytesPerRow,deallocator:.none));completed+=1
  if completed%48==0 || completed==total{print("FRAME \(completed)/\(total)");fflush(stdout)}
 }}
 renderer.scene=nil
}
try pipe.fileHandleForWriting.close();ffmpeg.waitUntilExit();if ffmpeg.terminationStatus != 0{exit(ffmpeg.terminationStatus)}
if let path=cameraDiagnosticPath{try JSONSerialization.data(withJSONObject:cameraDiagnostics,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:path))}
if let path=graphicsDiagnosticPath{try JSONSerialization.data(withJSONObject:graphicsDiagnostics,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:path))}
print("DONE \(output)")
