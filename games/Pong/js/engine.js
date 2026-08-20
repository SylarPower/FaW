import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080e);
    this.scene.fog = new THREE.Fog(0x07080e, 18, 48);

    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
    this.camera.position.set(0, 16.5, 13.5);
    this.look = new THREE.Vector3(0, 0, -0.4);
    this.camera.lookAt(this.look);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xb9c6ff, 0x1a120c, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e5, 1.15);
    this.sun.position.set(6, 16, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.camera.left = -16;
    this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -16;
    this.scene.add(this.sun);

    this.accentA = new THREE.PointLight(0x3dffd1, 1.4, 30, 2);
    this.accentA.position.set(-8, 6, 2);
    this.accentB = new THREE.PointLight(0xff3d7f, 1.3, 30, 2);
    this.accentB.position.set(8, 6, 2);
    this.scene.add(this.accentA, this.accentB);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.7, 0.22);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.shake = 0;
    this.camBase = this.camera.position.clone();
    this.camTarget = this.camera.position.clone();
    this.lookTarget = this.look.clone();
    this.arenaRoot = new THREE.Group();
    this.scene.add(this.arenaRoot);
    this.bgBits = [];
    this._buildAtmosphere();

    window.addEventListener("resize", () => this.resize());
  }

  _buildAtmosphere() {
    const starGeo = new THREE.BufferGeometry();
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 30 - 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0x9bb4ff, size: 0.05, transparent: true, opacity: 0.65 })
    );
    this.scene.add(stars);
    this.stars = stars;

    for (let i = 0; i < 8; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(10 + i * 2.2, 0.015, 6, 80),
        new THREE.MeshBasicMaterial({ color: 0x3dffd1, transparent: true, opacity: 0.04 + i * 0.008 })
      );
      ring.rotation.x = Math.PI / 2.4;
      ring.position.y = -2 - i * 0.3;
      this.scene.add(ring);
      this.bgBits.push(ring);
    }
  }

  setTheme(theme) {
    this.scene.background.set(theme.bg ?? 0x07080e);
    this.scene.fog.color.set(theme.fog ?? theme.bg ?? 0x07080e);
    this.accentA.color.set(theme.p1 ?? 0x3dffd1);
    this.accentB.color.set(theme.p2 ?? 0xff3d7f);
    const accent = theme.accentIntensity ?? 1;
    this.accentA.intensity = 1.4 * accent;
    this.accentB.intensity = 1.3 * accent;
    this.hemi.color.set(theme.hemi ?? 0xb9c6ff);
    this.hemi.intensity = theme.hemiIntensity ?? 0.7;
    this.sun.intensity = theme.sunIntensity ?? 1.15;
    this.bloom.strength = theme.bloom ?? 0.38;
    this.renderer.toneMappingExposure = theme.exposure ?? 1.05;
    if (this.stars) this.stars.visible = theme.showStars !== false;
    for (const ring of this.bgBits) ring.visible = theme.showRings !== false;
  }

  setCamera(pos, look, immediate = false) {
    this.camTarget.set(pos.x, pos.y, pos.z);
    this.lookTarget.set(look.x, look.y, look.z);
    if (immediate) {
      this.camera.position.copy(this.camTarget);
      this.look.copy(this.lookTarget);
      this.camera.lookAt(this.look);
    }
  }

  kick(amp = 0.18) {
    this.shake = Math.max(this.shake, amp);
  }

  flash(el, color = "#fff", ms = 80) {
    if (!el) return;
    el.style.background = color;
    el.style.opacity = "0.55";
    setTimeout(() => { el.style.transition = "opacity 0.25s"; el.style.opacity = "0"; }, ms);
    setTimeout(() => { el.style.transition = "none"; }, ms + 260);
  }

  clearArena() {
    while (this.arenaRoot.children.length) {
      this.arenaRoot.remove(this.arenaRoot.children[0]);
    }
  }

  add(obj) {
    this.arenaRoot.add(obj);
    return obj;
  }

  update(dt, ballFocus = null) {
    this.camera.position.lerp(this.camTarget, 1 - Math.pow(0.08, dt));
    this.look.lerp(this.lookTarget, 1 - Math.pow(0.1, dt));
    if (ballFocus) {
      this.look.x += (ballFocus.x * 0.12 - this.look.x) * 0.04;
      this.look.z += (ballFocus.z * 0.08 - this.look.z) * 0.04;
    }
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.pow(0.004, dt);
      if (this.shake < 0.002) this.shake = 0;
    }
    this.camera.lookAt(this.look);
    this.stars.rotation.y += dt * 0.01;
    for (let i = 0; i < this.bgBits.length; i++) {
      this.bgBits[i].rotation.z += dt * (0.02 + i * 0.004);
    }
  }

  render() {
    this.composer.render();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }
}
