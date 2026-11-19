import type { Agent } from '../types/village';

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function shadeHex(hex: string, factor: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, Math.round(((num >> 16) & 255) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((num >> 8) & 255) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((num & 255) * factor)));
  return `rgb(${r}, ${g}, ${b})`;
}

type HairStyle = 'parted' | 'curls' | 'ponytail' | 'bob' | 'braid' | 'waves';

function resolveHairStyle(id: string, role: Agent['role'], buildingId?: string, seed = 0): HairStyle {
  if (id === 'worker_elena' || id === 'elena') return 'ponytail';
  if (id === 'worker_layla' || id === 'aria') return 'bob';
  if (id === 'worker_aria') return 'braid';
  if (id === 'layla') return 'waves';
  if (id === 'worker_daniel' || id === 'worker_kieran' || id === 'noah') return 'curls';
  if (role === 'worker') {
    if (buildingId === 'youtube') return 'ponytail';
    if (buildingId === 'creative') return 'bob';
    if (buildingId === 'research') return 'braid';
    return seed % 2 === 0 ? 'curls' : 'parted';
  }
  return 'parted';
}

/**
 * Renders a soft 3D-shaded miniature storybook villager with smooth directional
 * walk cycles, alive idle breathing & blinking, chatting gestures, phone call waves,
 * and unique guild-specific garments, headgear, and tools for every role in the village.
 */
export function drawStorybookCharacter(
  ctx: CanvasRenderingContext2D,
  agent: Pick<
    Agent,
    | 'id'
    | 'name'
    | 'role'
    | 'shirtColor'
    | 'pantsColor'
    | 'hairColor'
    | 'skinColor'
    | 'hasYellowVest'
    | 'hasGlasses'
    | 'direction'
    | 'walkFrame'
    | 'isMoving'
    | 'state'
    | 'speechBubble'
  > & {
    buildingId?: string;
  },
  x: number,
  y: number,
  tick: number,
  options?: {
    selected?: boolean;
    proximityStrength?: number;
    isPrimaryNear?: boolean;
    scale?: number;
    hideLabel?: boolean;
    hideSpeech?: boolean;
  }
) {
  const scale = options?.scale ?? 1;
  const proximity = Math.max(0, Math.min(1, options?.proximityStrength ?? 0));
  const seed = hashString(agent.id) % 200;
  const { direction, walkFrame, isMoving, state } = agent;
  const isSide = direction === 'left' || direction === 'right';
  const facingSign = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
  const isWorker = agent.role === 'worker';
  const guild = agent.buildingId ?? '';
  const hairStyle = resolveHairStyle(agent.id, agent.role, guild, seed);

  // Smooth walk cycle vs. gentle alive idle breathing & conversational turn-taking
  const idlePhase = tick * 0.065 + seed;
  const breath = isMoving ? 0 : Math.sin(idlePhase) * 0.75;
  const isActivelySpeaking =
    !isMoving && Boolean(agent.speechBubble && agent.speechBubble !== '···');
  const isListeningInChat = !isMoving && state === 'chatting' && !isActivelySpeaking;
  const chatBounce = isActivelySpeaking
    ? Math.abs(Math.sin(tick * 0.17 + seed)) * 1.45
    : 0;
  const stride = isMoving ? Math.sin(walkFrame) * 5.2 : 0;
  const bob = (isMoving ? Math.abs(Math.cos(walkFrame)) * 2.4 : 0) + breath * 0.45 + chatBounce;
  const torsoTilt = isMoving && isSide ? facingSign * 0.055 : isActivelySpeaking && isSide ? facingSign * 0.035 : 0;

  // Natural eye blink every ~4 seconds
  const blinkFrame = (Math.floor(tick) + seed * 3) % 240;
  const isBlinking = blinkFrame < 6;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Subtle proximity availability pulse (when CHO is within conversation range)
  if (proximity > 0.01 && !options?.selected) {
    const pulseWave = 0.5 + 0.5 * Math.sin(tick * 0.085 + seed * 0.04);
    const rippleProg = (tick * 0.016 + (seed % 17) * 0.06) % 1;

    const auraAlpha = (0.12 + pulseWave * 0.1) * proximity;
    const auraGrad = ctx.createRadialGradient(0, 12.5, 2, 0, 12.5, 22);
    auraGrad.addColorStop(0, `rgba(125, 211, 252, ${auraAlpha * 1.25})`);
    auraGrad.addColorStop(0.55, `rgba(56, 189, 248, ${auraAlpha * 0.65})`);
    auraGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.ellipse(0, 12.5, 22, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    const innerRx = 14.2 + pulseWave * 1.3;
    const innerRy = 6.2 + pulseWave * 0.55;
    ctx.strokeStyle = `rgba(125, 211, 252, ${(0.28 + pulseWave * 0.24) * proximity})`;
    ctx.lineWidth = options?.isPrimaryNear ? 1.6 : 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 12.5, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.stroke();

    const rippleAlpha = Math.pow(1 - rippleProg, 1.7) * 0.38 * proximity;
    if (rippleAlpha > 0.015) {
      ctx.strokeStyle = `rgba(186, 230, 253, ${rippleAlpha})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, 12.5, 13.5 + rippleProg * 9.5, 5.8 + rippleProg * 4.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Selection ring with gentle pulse
  if (options?.selected) {
    const selPulse = 0.75 + Math.sin(tick * 0.1) * 0.2;
    ctx.strokeStyle = `rgba(251, 191, 36, ${selPulse})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 12.5, 16 + Math.sin(tick * 0.1) * 0.8, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Soft directional ambient shadow (shrinks slightly during stride bob)
  const shScale = 1 - Math.min(0.14, bob * 0.04);
  const shGrad = ctx.createRadialGradient(2, 13, 2, 2, 13, 14 * shScale);
  shGrad.addColorStop(0, 'rgba(20, 24, 15, 0.5)');
  shGrad.addColorStop(1, 'rgba(20, 24, 15, 0)');
  ctx.fillStyle = shGrad;
  ctx.beginPath();
  ctx.ellipse(2, 13, 13.5 * shScale, 5.8 * shScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs & crafted village leather boots
  const leftLegY = 4 + (isSide ? Math.max(0, -stride * 0.25) : stride * 0.62);
  const rightLegY = 4 + (isSide ? Math.max(0, stride * 0.25) : -stride * 0.62);
  const leftLegX = isSide ? -2.2 + stride * 0.95 : -5.1;
  const rightLegX = isSide ? -2.2 - stride * 0.95 : 0.9;

  for (const [lx, ly] of [
    [leftLegX, leftLegY],
    [rightLegX, rightLegY],
  ]) {
    ctx.fillStyle = agent.pantsColor;
    ctx.beginPath();
    ctx.roundRect(lx, ly, 4.5, 8.2, 2);
    ctx.fill();

    // Stitched leather village boot
    const bootX = lx + 2.25 + (isSide ? facingSign * 0.9 : 0);
    ctx.fillStyle = isWorker ? '#4A2C1B' : '#2E1D14';
    ctx.beginPath();
    ctx.ellipse(bootX, ly + 8, 3.2, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 237, 213, 0.18)';
    ctx.beginPath();
    ctx.ellipse(bootX - 0.6, ly + 7.4, 1.4, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.rotate(torsoTilt);

  // Back-slung gear visible behind torso when facing front/side (e.g., Zoe's parchment map scroll)
  if (isWorker && guild === 'research' && direction !== 'up') {
    ctx.save();
    ctx.translate(isSide ? -facingSign * 5.2 : 6.8, -8.5 - bob);
    ctx.rotate(0.45);
    ctx.fillStyle = '#F5E6C8';
    ctx.strokeStyle = '#92400E';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(-2.1, -6, 4.2, 12, 1.8);
    ctx.fill();
    ctx.stroke();
    // Red wax ribbon band on map scroll
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-2.2, -1, 4.4, 2);
    ctx.restore();
  }

  // Back arm (when front/back-facing, left arm swings at side)
  if (!isSide) {
    const leftArmSwing = isMoving ? -stride * 0.55 : Math.sin(idlePhase) * 0.5;
    ctx.fillStyle = agent.shirtColor;
    ctx.beginPath();
    ctx.roundRect(-12, -9 - bob + leftArmSwing, 4, 11, 2);
    ctx.fill();
    // Bookkeeper sleeve garter for Finance worker
    if (isWorker && guild === 'finance') {
      ctx.fillStyle = '#14532D';
      ctx.fillRect(-12.1, -4.2 - bob + leftArmSwing, 4.2, 1.7);
    }
    ctx.fillStyle = agent.skinColor;
    ctx.beginPath();
    ctx.arc(-10, 2.5 - bob + leftArmSwing, 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Torso with warm 3D cloth shading (preserves rich hue of cream, ochre, sage, plum, terracotta)
  const torsoW = isSide ? 13 : 17;
  const torsoLeft = -torsoW / 2;
  const torsoGrad = ctx.createLinearGradient(torsoLeft, -11 - bob, -torsoLeft, 5 - bob);
  torsoGrad.addColorStop(0, agent.shirtColor);
  torsoGrad.addColorStop(1, shadeHex(agent.shirtColor, 0.58));
  ctx.fillStyle = torsoGrad;
  ctx.beginPath();
  ctx.roundRect(torsoLeft, -10.5 - bob, torsoW, 15.5, 5);
  ctx.fill();

  // Sunlit rim highlight on top-left edge
  ctx.fillStyle = 'rgba(255, 250, 235, 0.22)';
  ctx.beginPath();
  ctx.roundRect(torsoLeft + 0.6, -10 - bob, 5, 13, 2.5);
  ctx.fill();

  // =========================================================================
  // ROLE-SPECIFIC STORYBOOK VILLAGE ATTIRE & CRAFT TOOLS
  // =========================================================================
  if (isWorker) {
    if (guild === 'inbox') {
      // SAM — Village Postal & Schedule Courier: brass-buttoned coat + leather mailbag with sealed letter
      if (direction !== 'up') {
        const cx = isSide ? facingSign * 2.2 : 0;
        // Crisp cream linen collar V
        ctx.fillStyle = '#FEF3C7';
        ctx.beginPath();
        ctx.moveTo(cx - 2.6, -10.4 - bob);
        ctx.lineTo(cx + 2.6, -10.4 - bob);
        ctx.lineTo(cx, -6.8 - bob);
        ctx.closePath();
        ctx.fill();
        // Brass courier buttons
        ctx.fillStyle = '#FBBF24';
        for (const by of [-5.2, -2.2, 0.8]) {
          ctx.beginPath();
          ctx.arc(cx, by - bob, 0.85, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Diagonal stitched leather courier strap
      ctx.strokeStyle = '#78350F';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(torsoLeft + 2, -10.2 - bob);
      ctx.lineTo(-torsoLeft - 1.5, 3.2 - bob);
      ctx.stroke();

      // Leather mail satchel at hip with peeking wax-sealed envelope
      const bagX = isSide ? facingSign * 1.2 : 4.2;
      ctx.fillStyle = '#92400E';
      ctx.strokeStyle = '#451A03';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.roundRect(bagX - 3.6, -1.8 - bob, 7.2, 6.4, 1.6);
      ctx.fill();
      ctx.stroke();
      if (direction !== 'up') {
        // Peeking white letter + red wax dot
        ctx.fillStyle = '#FFFBEB';
        ctx.fillRect(bagX - 2.3, -2.8 - bob, 4.6, 2.4);
        ctx.fillStyle = '#DC2626';
        ctx.beginPath();
        ctx.arc(bagX, -1.4 - bob, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (guild === 'youtube') {
      // MAYA — Studio Cinematographer & Recordist: studio lanyard clapperboard pass + rangefinder camera
      if (direction !== 'up') {
        const cx = isSide ? facingSign * 2 : 0;
        // Woven lanyard
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx - 2.4, -10.2 - bob);
        ctx.lineTo(cx, -4.6 - bob);
        ctx.lineTo(cx + 2.4, -10.2 - bob);
        ctx.stroke();
        // Mini clapperboard / studio pass
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.roundRect(cx - 2.8, -4.8 - bob, 5.6, 4.4, 0.9);
        ctx.fill();
        ctx.fillStyle = '#FBBF24';
        ctx.fillRect(cx - 2.8, -4.8 - bob, 5.6, 1.3);
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(cx + 1.2, -2.1 - bob, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // Compact vintage camera slung at hip
      const camX = isSide ? -facingSign * 1.5 : -5.5;
      ctx.fillStyle = '#1E293B';
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.roundRect(camX - 2.6, 0.2 - bob, 5.2, 4, 1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(camX, 2.2 - bob, 1.15, 0, Math.PI * 2);
      ctx.fill();
    } else if (guild === 'finance') {
      // LEO — Guild Bookkeeper & Ledger Clerk: emerald tailored waistcoat + brass buttons + gold-clasped ledger
      const vestGrad = ctx.createLinearGradient(torsoLeft, -10 - bob, -torsoLeft, 4.5 - bob);
      vestGrad.addColorStop(0, '#15803D');
      vestGrad.addColorStop(1, '#14532D');
      ctx.fillStyle = vestGrad;
      ctx.beginPath();
      ctx.roundRect(torsoLeft + 0.8, -10 - bob, torsoW - 1.6, 14.5, 3.5);
      ctx.fill();

      if (direction !== 'up') {
        const cx = isSide ? facingSign * 2.2 : 0;
        // Ivory shirt V-neck & tie under waistcoat
        ctx.fillStyle = '#FAF5EB';
        ctx.beginPath();
        ctx.moveTo(cx - 2.8, -10.2 - bob);
        ctx.lineTo(cx + 2.8, -10.2 - bob);
        ctx.lineTo(cx, -4.8 - bob);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#991B1B';
        ctx.fillRect(cx - 0.75, -9.6 - bob, 1.5, 4.3);
        // Brass waistcoat buttons
        ctx.fillStyle = '#FBBF24';
        for (const by of [-3.2, -0.6, 2.0]) {
          ctx.beginPath();
          ctx.arc(cx, by - bob, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Gold-edged leather ledger book tucked under arm / at hip
      const bookX = isSide ? facingSign * 2.5 : -5.4;
      ctx.fillStyle = '#7C2D12';
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.roundRect(bookX - 2.4, -2.5 - bob, 4.8, 6.4, 1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FEF3C7';
      ctx.fillRect(bookX - 1.2, -1.3 - bob, 2.4, 1.2);
    } else if (guild === 'research') {
      // ZOE — Field Cartographer & Scout: hooded ranger capelet + brass clasp + utility belt (+ scroll on back)
      ctx.fillStyle = '#365343';
      ctx.beginPath();
      ctx.roundRect(torsoLeft - 0.8, -10.6 - bob, torsoW + 1.6, 7.2, 3.5);
      ctx.fill();
      // Leather field belt
      ctx.fillStyle = '#5C3A21';
      ctx.fillRect(torsoLeft + 0.3, 1.2 - bob, torsoW - 0.6, 2.3);
      if (direction !== 'up') {
        const cx = isSide ? facingSign * 2.2 : 0;
        // Brass compass cloak clasp
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(cx, -7.2 - bob, 1.5, 0, Math.PI * 2);
        ctx.fill();
        // Belt brass buckle
        ctx.strokeStyle = '#FBBF24';
        ctx.lineWidth = 0.9;
        ctx.strokeRect(cx - 1.4, 1.1 - bob, 2.8, 2.4);
      } else {
        // Scroll visible clearly across back when walking away!
        ctx.save();
        ctx.translate(0, -3.5 - bob);
        ctx.rotate(-0.45);
        ctx.fillStyle = '#F5E6C8';
        ctx.strokeStyle = '#92400E';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.roundRect(-6.5, -2.1, 13, 4.2, 1.8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#DC2626';
        ctx.fillRect(-1, -2.2, 2, 4.4);
        ctx.restore();
      }
    } else if (guild === 'operations') {
      // ELI — Master Wright & Quartermaster: heavy riveted saddle-leather bib apron + tool pocket & checklist
      if (direction !== 'up') {
        const apronW = isSide ? torsoW - 2.5 : 11.6;
        const apronX = isSide ? (facingSign > 0 ? -3.5 : -6.8) : -apronW / 2;
        // Leather shoulder straps
        ctx.fillStyle = '#5C3317';
        if (!isSide) {
          ctx.fillRect(-4.8, -10.4 - bob, 2.1, 4);
          ctx.fillRect(2.7, -10.4 - bob, 2.1, 4);
        }
        const apronGrad = ctx.createLinearGradient(apronX, -7 - bob, apronX + apronW, 5 - bob);
        apronGrad.addColorStop(0, '#854D27');
        apronGrad.addColorStop(1, '#582F14');
        ctx.fillStyle = apronGrad;
        ctx.beginPath();
        ctx.roundRect(apronX, -7.2 - bob, apronW, 12.2, 2.2);
        ctx.fill();

        // Brass corner rivets
        ctx.fillStyle = '#FBBF24';
        ctx.beginPath();
        ctx.arc(apronX + 1.6, -5.6 - bob, 0.7, 0, Math.PI * 2);
        ctx.arc(apronX + apronW - 1.6, -5.6 - bob, 0.7, 0, Math.PI * 2);
        ctx.fill();

        // Front pocket with miniature checklist / brass spanner peeking out
        const px = apronX + apronW / 2;
        ctx.fillStyle = '#43220E';
        ctx.fillRect(px - 3.2, -1.2 - bob, 6.4, 4.2);
        ctx.fillStyle = '#FEF3C7';
        ctx.fillRect(px - 2.2, -3.1 - bob, 3, 2.2);
        ctx.fillStyle = '#CBD5E1';
        ctx.fillRect(px + 1.2, -3.5 - bob, 1.4, 2.6);
      } else {
        // Crossed leather apron straps on back
        ctx.strokeStyle = '#5C3317';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-4.5, -10 - bob);
        ctx.lineTo(4.5, 2 - bob);
        ctx.moveTo(4.5, -10 - bob);
        ctx.lineTo(-4.5, 2 - bob);
        ctx.stroke();
      }
    } else if (guild === 'creative') {
      // NORA — Atelier Painter & Printmaker: cream linen artist smock apron with colorful paint dabs & brushes
      if (direction !== 'up') {
        const apronW = isSide ? torsoW - 2.4 : 11.8;
        const apronX = isSide ? (facingSign > 0 ? -3.4 : -6.8) : -apronW / 2;
        ctx.fillStyle = '#F5EFE6';
        ctx.beginPath();
        ctx.roundRect(apronX, -7.8 - bob, apronW, 12.6, 2.5);
        ctx.fill();

        // Cheerful paint dabs on linen apron
        const cx = apronX + apronW / 2;
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(cx - 2.4, -2.5 - bob, 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#38BDF8';
        ctx.beginPath();
        ctx.arc(cx + 2.1, -0.4 - bob, 1.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#F43F5E';
        ctx.beginPath();
        ctx.arc(cx - 0.8, 2.1 - bob, 1.1, 0, Math.PI * 2);
        ctx.fill();

        // Tiny brush stems peeking from chest pocket
        ctx.strokeStyle = '#92400E';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + 1.5, -4.5 - bob);
        ctx.lineTo(cx + 2.6, -7.8 - bob);
        ctx.stroke();
      } else {
        // Tied linen apron bow on back
        ctx.fillStyle = '#F5EFE6';
        ctx.fillRect(torsoLeft + 0.5, -1 - bob, torsoW - 1, 2.2);
      }
    } else if (guild === 'health') {
      // OWEN — Herbalist & Greenhouse Steward: woven natural canvas garden apron + fresh green herb sprigs
      ctx.fillStyle = '#4D7C0F';
      ctx.fillRect(torsoLeft + 0.4, -2.2 - bob, torsoW - 0.8, 2.2);
      if (direction !== 'up') {
        const apronW = isSide ? torsoW - 2.4 : 11.8;
        const apronX = isSide ? (facingSign > 0 ? -3.4 : -6.8) : -apronW / 2;
        ctx.fillStyle = '#E2D7BE';
        ctx.beginPath();
        ctx.roundRect(apronX, -6.8 - bob, apronW, 11.8, 2.4);
        ctx.fill();

        // Woven herb pouch with fresh botanical sprigs
        const cx = apronX + apronW / 2;
        ctx.fillStyle = '#C8B998';
        ctx.beginPath();
        ctx.roundRect(cx - 3.4, -1 - bob, 6.8, 4.4, 1.2);
        ctx.fill();
        ctx.fillStyle = '#22C55E';
        ctx.beginPath();
        ctx.ellipse(cx - 1.3, -2 - bob, 1.6, 2.4, -0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#15803D';
        ctx.beginPath();
        ctx.ellipse(cx + 1.3, -2.2 - bob, 1.5, 2.3, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (guild === 'engineering') {
      // TOBY — Copper & Volt Systems Tinkerer: cross-chest insulated leather bandolier + glowing cyan circuit core + brass meter
      ctx.strokeStyle = '#6B3E26';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(torsoLeft + 1.8, -10 - bob);
      ctx.lineTo(-torsoLeft - 1.8, 3.4 - bob);
      ctx.stroke();

      // Utility belt
      ctx.fillStyle = '#452719';
      ctx.fillRect(torsoLeft + 0.3, 1.4 - bob, torsoW - 0.6, 2.4);

      if (direction !== 'up') {
        const cx = isSide ? facingSign * 1.4 : -0.8;
        // Copper-framed cyan telemetry core on bandolier
        ctx.fillStyle = '#D97706';
        ctx.beginPath();
        ctx.arc(cx, -3.6 - bob, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#38BDF8';
        ctx.beginPath();
        ctx.arc(cx, -3.6 - bob, 1.25, 0, Math.PI * 2);
        ctx.fill();

        // Brass diagnostic meter at hip
        const meterX = isSide ? facingSign * 2 : 4.2;
        ctx.fillStyle = '#B45309';
        ctx.fillRect(meterX - 2, 0.6 - bob, 4, 3.8);
        ctx.fillStyle = '#7DD3FC';
        ctx.fillRect(meterX - 1.2, 1.3 - bob, 2.4, 1.5);
      }
    } else if (agent.hasYellowVest) {
      // Fallback artisan vest
      const vestGrad = ctx.createLinearGradient(torsoLeft, -10 - bob, -torsoLeft, 4 - bob);
      vestGrad.addColorStop(0, '#D97706');
      vestGrad.addColorStop(1, '#92400E');
      ctx.fillStyle = vestGrad;
      ctx.beginPath();
      ctx.roundRect(torsoLeft + 1, -10 - bob, torsoW - 2, 14.5, 3);
      ctx.fill();
    }
  } else if (agent.id === 'matt' && direction !== 'up') {
    // Tailored Suit & Tie for Chief of Staff Matt
    const tieOffsetX = isSide ? facingSign * 2.5 : 0;
    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.moveTo(tieOffsetX - 3, -10.5 - bob);
    ctx.lineTo(tieOffsetX + 3, -10.5 - bob);
    ctx.lineTo(tieOffsetX, -1.5 - bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2563EB';
    ctx.fillRect(tieOffsetX - 0.9, -9.5 - bob, 1.8, 7.5);
  } else if (agent.role === 'director' && direction !== 'up') {
    // Subtle Guild Master collar & gold lapel pin for the 8 Village Directors
    const cx = isSide ? facingSign * 2.3 : 0;
    ctx.fillStyle = 'rgba(254, 243, 199, 0.9)';
    ctx.beginPath();
    ctx.moveTo(cx - 2.6, -10.4 - bob);
    ctx.lineTo(cx + 2.6, -10.4 - bob);
    ctx.lineTo(cx, -6.2 - bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FBBF24';
    ctx.beginPath();
    ctx.arc(cx + (isSide ? 0 : 3.2), -7.2 - bob, 0.95, 0, Math.PI * 2);
    ctx.fill();
  }

  // Front/Right Arm & Special Gestures (Phone call / Chatting wave)
  if (state === 'phone_call') {
    const phoneNod = Math.sin(tick * 0.14) * 0.8;
    ctx.fillStyle = agent.shirtColor;
    ctx.beginPath();
    ctx.roundRect(6.5, -16 - bob + phoneNod, 4, 10, 2);
    ctx.fill();
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.roundRect(9, -20.5 - bob + phoneNod, 3.8, 6.6, 1);
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(9.8, -19.5 - bob + phoneNod, 2.2, 4.4);

    for (let w = 0; w < 2; w++) {
      const pulse = ((tick * 0.8 + w * 16) % 32) / 32;
      ctx.strokeStyle = `rgba(56, 189, 248, ${(1 - pulse) * 0.9})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(11.5, -18 - bob + phoneNod, 4.5 + pulse * 10, -0.85, 0.85);
      ctx.stroke();
    }
  } else if (isSide) {
    const sideTalkReach = isActivelySpeaking
      ? facingSign * (3.2 + Math.sin(tick * 0.24 + seed) * 2.1)
      : 0;
    const sideTalkLift = isActivelySpeaking
      ? -2.8 + Math.cos(tick * 0.24 + seed) * 1.6
      : 0;
    const sideArmSwing = isMoving
      ? stride * 0.85
      : Math.sin(idlePhase) * 0.6 + sideTalkReach;
    ctx.fillStyle = agent.shirtColor;
    ctx.beginPath();
    ctx.roundRect(-2 + sideArmSwing * 0.8, -8.5 - bob + sideTalkLift * 0.6, 4.2, 10.5, 2);
    ctx.fill();
    if (isWorker && guild === 'finance') {
      ctx.fillStyle = '#14532D';
      ctx.fillRect(-2.1 + sideArmSwing * 0.8, -4.2 - bob + sideTalkLift * 0.6, 4.4, 1.7);
    }
    ctx.fillStyle = agent.skinColor;
    ctx.beginPath();
    ctx.arc(sideArmSwing * 0.85, 2.6 - bob + sideTalkLift, 2.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const chatWave = isActivelySpeaking ? Math.sin(tick * 0.22 + seed) * 3.8 - 3.6 : 0;
    const rightArmSwing = isMoving ? stride * 0.55 : -Math.sin(idlePhase) * 0.5 + chatWave;
    ctx.fillStyle = agent.shirtColor;
    ctx.beginPath();
    ctx.roundRect(8, -9 - bob + rightArmSwing * 0.6, 4, 11, 2);
    ctx.fill();
    if (isWorker && guild === 'finance') {
      ctx.fillStyle = '#14532D';
      ctx.fillRect(7.9, -4.2 - bob + rightArmSwing * 0.6, 4.2, 1.7);
    }
    ctx.fillStyle = agent.skinColor;
    ctx.beginPath();
    ctx.arc(10, 2.5 - bob + rightArmSwing * 0.6, 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // =========================================================================
  // SCULPTED 3D HEAD, VARIED HAIRSTYLES & CRAFT HEADGEAR
  // =========================================================================
  const listenNod = isListeningInChat ? Math.sin(tick * 0.12 + seed) * 0.95 : 0;
  const headY = -18 - bob + listenNod;

  // Back hair extensions (ponytail / braid / bob / waves drawn behind face contour)
  ctx.fillStyle = agent.hairColor;
  if (hairStyle === 'ponytail') {
    const px = isSide ? -facingSign * 7.8 : direction === 'up' ? 0 : 6.8;
    ctx.beginPath();
    ctx.ellipse(px, headY + 2.5, 3.2, 5.4, isSide ? -facingSign * 0.35 : 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (hairStyle === 'braid') {
    const bx = isSide ? -facingSign * 6.5 : 6.2;
    for (let seg = 0; seg < 3; seg++) {
      ctx.beginPath();
      ctx.arc(bx + (direction === 'up' ? -6.2 : 0), headY + 2.2 + seg * 2.6, 2.1 - seg * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (hairStyle === 'bob' || hairStyle === 'waves') {
    const extraLen = hairStyle === 'waves' ? 7.2 : 5.4;
    ctx.beginPath();
    ctx.roundRect(-9.2, headY - 2, 18.4, extraLen + 3, 5);
    ctx.fill();
  }

  // Sculpted 3D Head with radial soft shading
  const headGrad = ctx.createRadialGradient(-3, headY - 3, 1.5, 0, headY, 10);
  headGrad.addColorStop(0, '#FFF1E6');
  headGrad.addColorStop(0.55, agent.skinColor);
  headGrad.addColorStop(1, '#B47B56');
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(0, headY, 8.6, 0, Math.PI * 2);
  ctx.fill();

  if (direction === 'up') {
    ctx.fillStyle = agent.hairColor;
    ctx.beginPath();
    ctx.arc(0, headY - 0.8, 8.85, Math.PI * 0.88, Math.PI * 2.12);
    ctx.quadraticCurveTo(8, headY + 4.5, 0, headY + 5);
    ctx.quadraticCurveTo(-8, headY + 4.5, -8.8, headY - 0.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.ellipse(-2.5, headY - 5.2, 3.8, 1.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Hair cap + style-specific bangs / curls
    ctx.fillStyle = agent.hairColor;
    ctx.beginPath();
    ctx.arc(0, headY - 1.8, 8.9, Math.PI * 0.9, Math.PI * 2.1);
    ctx.quadraticCurveTo(4, headY - 4.4, 0, headY - 3.2);
    ctx.quadraticCurveTo(-5, headY - 4.4, -8.8, headY - 1.2);
    ctx.fill();

    if (hairStyle === 'curls') {
      for (const cx of [-5.2, -1.8, 1.8, 5.2]) {
        ctx.beginPath();
        ctx.arc(cx, headY - 5.4, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (isSide) {
      ctx.beginPath();
      ctx.roundRect(facingSign > 0 ? -8.6 : 5.2, headY - 3, 3.4, 6.2, 1.5);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(-2.4, headY - 5.5, 4, 1.5, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Eyes with natural blink
    const eyeOffsetX = direction === 'left' ? -2.6 : direction === 'right' ? 2.6 : 0;
    const eyeLeftX = -2.7 + eyeOffsetX;
    const eyeRightX = 2.7 + eyeOffsetX;
    const eyeY = headY + 0.5;

    if (isBlinking) {
      ctx.strokeStyle = '#1C1917';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(eyeLeftX - 1.4, eyeY);
      ctx.lineTo(eyeLeftX + 1.4, eyeY);
      ctx.moveTo(eyeRightX - 1.4, eyeY);
      ctx.lineTo(eyeRightX + 1.4, eyeY);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1C1917';
      ctx.beginPath();
      ctx.arc(eyeLeftX, eyeY, 1.25, 0, Math.PI * 2);
      ctx.arc(eyeRightX, eyeY, 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(eyeLeftX - 0.5, eyeY - 0.7, 0.8, 0.8);
      ctx.fillRect(eyeRightX - 0.5, eyeY - 0.7, 0.8, 0.8);
    }

    if (agent.hasGlasses || (isWorker && guild === 'finance')) {
      // Brass round spectacles for Finance bookkeeper; sleek slate frames for others
      const isBrass = isWorker && guild === 'finance';
      ctx.strokeStyle = isBrass ? 'rgba(217, 119, 6, 0.95)' : 'rgba(30, 41, 59, 0.85)';
      ctx.lineWidth = 1.1;
      if (isBrass) {
        ctx.beginPath();
        ctx.arc(eyeLeftX, eyeY, 2.0, 0, Math.PI * 2);
        ctx.arc(eyeRightX, eyeY, 2.0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(eyeLeftX - 1.9, eyeY - 1.7, 3.8, 3.4);
        ctx.strokeRect(eyeRightX - 1.9, eyeY - 1.7, 3.8, 3.4);
      }
    }
  }

  // =========================================================================
  // JOB-SPECIFIC VILLAGE HATS, CAPS, HEADPHONES & GOGGLES
  // =========================================================================
  if (agent.role === 'cho') {
    // CHO Gold Crown
    ctx.fillStyle = '#FBBF24';
    ctx.beginPath();
    ctx.moveTo(-5, headY - 9);
    ctx.lineTo(-3, headY - 13.5);
    ctx.lineTo(0, headY - 10.2);
    ctx.lineTo(3, headY - 13.5);
    ctx.lineTo(5, headY - 9);
    ctx.closePath();
    ctx.fill();
  } else if (isWorker) {
    if (guild === 'inbox') {
      // Postal Courier Visor Cap with brass post emblem
      ctx.fillStyle = '#1E3A5F';
      ctx.beginPath();
      ctx.ellipse(0, headY - 7.4, 8.8, 4.2, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-8.2, headY - 7.6, 16.4, 2.5);
      if (direction !== 'up') {
        const billX = isSide ? facingSign * 3.2 : 0;
        ctx.fillStyle = '#1C1917';
        ctx.beginPath();
        ctx.ellipse(billX, headY - 5.1, isSide ? 6.2 : 7.4, 1.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FBBF24';
        ctx.beginPath();
        ctx.arc(isSide ? facingSign * 4.2 : 0, headY - 7.8, 1.35, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (guild === 'youtube') {
      // Studio Over-Ear Monitor Headphones
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, headY - 1.2, 9.4, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      if (isSide) {
        // Side profile shows prominent cushioned earcup with amber studio ring
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.ellipse(0, headY + 0.5, 2.8, 3.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        for (const ex of [-9.1, 9.1]) {
          ctx.fillStyle = '#0F172A';
          ctx.beginPath();
          ctx.roundRect(ex - 1.6, headY - 2.6, 3.2, 6, 1.4);
          ctx.fill();
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(ex - 0.6, headY - 1.5, 1.2, 3.8);
        }
      }
    } else if (guild === 'finance' && direction !== 'up') {
      // Classic translucent green Guild Bookkeeper's eyeshade visor
      const vx = isSide ? facingSign * 2.8 : 0;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.72)';
      ctx.beginPath();
      ctx.ellipse(vx, headY - 4.8, isSide ? 6 : 7.5, 1.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FEF3C7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-7.8, headY - 5.4);
      ctx.lineTo(7.8, headY - 5.4);
      ctx.stroke();
    } else if (guild === 'research') {
      // Explorer's Felt Field Hat with teal ribbon band
      ctx.fillStyle = '#5C4028';
      ctx.beginPath();
      ctx.ellipse(0, headY - 6.2, 11.4, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-6.8, headY - 11.4, 13.6, 5.5, 3);
      ctx.fill();
      ctx.fillStyle = '#0D9488';
      ctx.fillRect(-6.8, headY - 7.6, 13.6, 1.5);
    } else if (guild === 'operations') {
      // Warm Tweed Craftsman Flat Cap (Newsboy Cap)
      ctx.fillStyle = '#6B5B4B';
      ctx.beginPath();
      ctx.ellipse(isSide ? -facingSign * 0.8 : 0, headY - 7.2, 8.9, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      if (direction !== 'up') {
        ctx.fillStyle = '#44382D';
        ctx.beginPath();
        ctx.ellipse(isSide ? facingSign * 3.8 : 0, headY - 5.4, isSide ? 5.6 : 7.2, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (guild === 'creative') {
      // Tilted Crimson-Plum French Artist's Beret
      ctx.save();
      ctx.translate(-1.2, headY - 8.2);
      ctx.rotate(-0.18);
      ctx.fillStyle = '#9D174D';
      ctx.beginPath();
      ctx.ellipse(0, 0, 9.2, 3.7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tiny beret stem
      ctx.strokeStyle = '#831843';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(0, -3.2);
      ctx.lineTo(0.8, -5.0);
      ctx.stroke();
      ctx.restore();
    } else if (guild === 'health') {
      // Woven Golden Sun-Straw Gardener's Hat with olive ribbon
      ctx.fillStyle = '#E8C670';
      ctx.strokeStyle = '#B48A3E';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, headY - 6.2, 11.8, 3.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#F2D68B';
      ctx.beginPath();
      ctx.roundRect(-6.8, headY - 11.2, 13.6, 5.2, 2.8);
      ctx.fill();
      ctx.fillStyle = '#15803D';
      ctx.fillRect(-6.8, headY - 7.5, 13.6, 1.6);
    } else if (guild === 'engineering') {
      // Brass & Cyan-Lens Tinkerer's Goggles perched on forehead
      ctx.fillStyle = '#78350F';
      ctx.fillRect(-8.5, headY - 6.8, 17, 2.1);
      if (direction !== 'up') {
        const gxOffset = isSide ? facingSign * 2.4 : 0;
        for (const gx of [-3.1 + gxOffset, 3.1 + gxOffset]) {
          ctx.fillStyle = '#D97706';
          ctx.beginPath();
          ctx.arc(gx, headY - 5.8, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#7DD3FC';
          ctx.beginPath();
          ctx.arc(gx, headY - 5.8, 1.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.restore(); // end torso tilt

  // Subtle floating nameplate (brightens gently when within conversation proximity)
  if (!options?.hideLabel) {
    ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
    const baseLabel = agent.id === 'cho' ? 'You (CHO)' : agent.name.replace(' (Worker)', '');
    const showTalkHint = Boolean(options?.isPrimaryNear && agent.id !== 'cho');
    const fullLabel = showTalkHint ? `${baseLabel} · T` : baseLabel;
    const textW = ctx.measureText(fullLabel).width;
    ctx.fillStyle =
      agent.id === 'cho'
        ? 'rgba(180, 83, 9, 0.9)'
        : proximity > 0.05
          ? 'rgba(15, 23, 42, 0.86)'
          : 'rgba(20, 22, 18, 0.72)';
    ctx.beginPath();
    ctx.roundRect(-textW / 2 - 5, 16, textW + 10, 14.5, 4);
    ctx.fill();

    if (proximity > 0.05 && agent.id !== 'cho') {
      const borderPulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(tick * 0.085 + seed * 0.04));
      ctx.strokeStyle = options?.selected
        ? 'rgba(251, 191, 36, 0.8)'
        : `rgba(125, 211, 252, ${borderPulse * proximity})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (showTalkHint) {
      const baseW = ctx.measureText(baseLabel).width;
      const hintText = ' · T';
      const startX = -textW / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FEF3C7';
      ctx.fillText(baseLabel, startX, 26.5);
      ctx.fillStyle = '#7DD3FC';
      ctx.fillText(hintText, startX + baseW, 26.5);
    } else {
      ctx.fillStyle = '#FEF3C7';
      ctx.textAlign = 'center';
      ctx.fillText(fullLabel, 0, 26.5);
    }
  }

  // Speech Bubble (gentle hover float, 2-line word wrap & directional tail)
  if (!options?.hideSpeech && agent.speechBubble) {
    const bubbleFloat = Math.sin(tick * 0.1 + seed) * 1.2;
    const rawBubble = agent.speechBubble.trim();

    if (rawBubble === '···') {
      const bw = 34;
      const bh = 18;
      const topY = -53 - bob + bubbleFloat;
      ctx.fillStyle = 'rgba(255, 251, 235, 0.97)';
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.5)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, topY, bw, bh, 7);
      ctx.fill();
      ctx.stroke();

      // Pointer triangle tail
      ctx.beginPath();
      ctx.moveTo(-3.5, topY + bh - 0.5);
      ctx.lineTo(0, topY + bh + 4.5);
      ctx.lineTo(3.5, topY + bh - 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      for (let d = 0; d < 3; d++) {
        const dotPulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tick * 0.22 - d * 0.9));
        ctx.fillStyle = `rgba(180, 83, 9, ${dotPulse})`;
        ctx.beginPath();
        ctx.arc(-7 + d * 7, topY + bh / 2, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.font = '500 10.5px "Plus Jakarta Sans", sans-serif';
      const clipped = rawBubble.length > 88 ? `${rawBubble.slice(0, 85).trimEnd()}...` : rawBubble;
      const words = clipped.split(/\s+/);
      const lines: string[] = [];
      let currentLine = '';
      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length <= 44 || !currentLine) {
          currentLine = candidate;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) lines.push(currentLine);
      if (lines.length > 2) {
        const second = `${lines[1]} ${lines.slice(2).join(' ')}`;
        lines.length = 2;
        lines[1] = second.length > 44 ? `${second.slice(0, 41).trimEnd()}...` : second;
      }

      const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const bw = Math.max(46, Math.ceil(maxLineW + 18));
      const lineH = 13.5;
      const bh = lines.length === 1 ? 22 : 34;
      const shiftX = isSide && state === 'chatting' ? -facingSign * 14 : 0;
      const topY = -36 - bh - bob + bubbleFloat;

      // Subtle drop shadow for readability when two villagers stand together
      ctx.fillStyle = 'rgba(15, 23, 42, 0.24)';
      ctx.beginPath();
      ctx.roundRect(-bw / 2 + shiftX + 1, topY + 2, bw, bh, 7);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 251, 235, 0.98)';
      ctx.strokeStyle =
        state === 'chatting' ? 'rgba(217, 119, 6, 0.65)' : 'rgba(68, 64, 60, 0.48)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.roundRect(-bw / 2 + shiftX, topY, bw, bh, 7);
      ctx.fill();
      ctx.stroke();

      // Pointer tail aimed at speaker's head (x = 0)
      const tailBaseX = Math.max(-bw / 2 + shiftX + 9, Math.min(bw / 2 + shiftX - 9, 0));
      ctx.fillStyle = 'rgba(255, 251, 235, 0.98)';
      ctx.beginPath();
      ctx.moveTo(tailBaseX - 4, topY + bh - 0.8);
      ctx.lineTo(0, topY + bh + 5);
      ctx.lineTo(tailBaseX + 4, topY + bh - 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tailBaseX - 4, topY + bh - 0.4);
      ctx.lineTo(0, topY + bh + 5);
      ctx.lineTo(tailBaseX + 4, topY + bh - 0.4);
      ctx.stroke();

      ctx.fillStyle = '#1C1917';
      ctx.textAlign = 'center';
      lines.forEach((line, idx) => {
        const textY =
          lines.length === 1 ? topY + 14.5 : topY + 13 + idx * lineH;
        ctx.fillText(line, shiftX, textY);
      });
    }
  }

  ctx.restore();
}
