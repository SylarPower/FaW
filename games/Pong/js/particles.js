import * as THREE from "three";

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.trails = [];
  }

  burst(x, y, z, color, n = 18, speed = 4) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + Math.random() * 0.05, 6, 6),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 1 })
      );
      m.position.set(x, y, z);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.8,
        (Math.random() - 0.5) * speed
      );
      this.scene.add(m);
      this.items.push({ mesh: m, v, life: 0.45 + Math.random() * 0.35, age: 0 });
    }
  }

  spark(x, y, z, dir, color) {
    this.burst(x, y, z, color, 10, 3.5);
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      p.v.y -= 8 * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      const t = 1 - p.age / p.life;
      p.mesh.material.opacity = Math.max(0, t);
      p.mesh.scale.setScalar(Math.max(0.01, t));
      if (p.age >= p.life) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.items) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.items.length = 0;
  }
}

export class BallTrail {
  constructor(scene, color, max = 14) {
    this.scene = scene;
    this.max = max;
    this.disabled = max <= 0;
    this.meshes = [];
    this.i = 0;
    this.acc = 0;
    this.baseColor = new THREE.Color(color);
    this.hotColor = new THREE.Color(0xff5a3d);
    this._tmp = new THREE.Color();
    if (this.disabled) return;
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 8),
        new THREE.MeshBasicMaterial({ color: this.baseColor, transparent: true, opacity: 0 })
      );
      m.visible = false;
      scene.add(m);
      this.meshes.push(m);
    }
  }
  setColor(color) {
    this.baseColor.set(color);
    for (const m of this.meshes) m.material.color.copy(this.baseColor);
  }
  update(dt, ball) {
    if (this.disabled) return;
    this.acc += dt;
    if (ball && ball.alive && !ball.held && this.acc > 0.018) {
      this.acc = 0;
      const spd = Math.hypot(ball.vx, ball.vz);
      const m = this.meshes[this.i % this.max];
      this.i++;
      m.visible = true;
      m.position.set(ball.x, ball.y, ball.z);
      // Feedback di velocità: la scia diventa più grande, più accesa e più
      // calda man mano che la palla accelera.
      const heat = Math.min(1, spd / 55);
      this._tmp.copy(this.baseColor).lerp(this.hotColor, heat);
      m.material.color.copy(this._tmp);
      m.material.opacity = 0.3 + heat * 0.55;
      m.scale.setScalar(0.7 + heat * 1.5);
    }
    for (const m of this.meshes) {
      if (!m.visible) continue;
      m.material.opacity *= Math.pow(0.04, dt);
      m.scale.multiplyScalar(Math.pow(0.12, dt));
      if (m.material.opacity < 0.02) m.visible = false;
    }
  }
  dispose() {
    if (this.disabled) return;
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
