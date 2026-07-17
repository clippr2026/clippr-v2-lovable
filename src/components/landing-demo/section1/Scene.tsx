import * as React from "react";
import sceneImg from "@/assets/landing/section1/scene.png";

// Silla de barbería: foto real de alta resolución (plano general del
// local completo), no un recorte del storyboard ni un banco de imágenes.
// A resolución nativa la silla ocupa solo ~26% del ancho de la foto — un
// plano "de arquitectura", no de producto — así que además del object-fit
// de base se aplica un zoom con transform:scale sobre un wrapper interno
// (transformOrigin anclado al mismo punto que object-position) para que
// la silla vuelva a ser protagonista sin recortar apoyabrazos/base y sin
// perder el piso y el tubo de neón alrededor.
//
// El contenedor ya NO está centrado: el borde izquierdo/superior se
// alinea con donde arranca "soñaste." (mismo padding que el bloque de
// título en Section1.tsx, sumado a la altura del header — si se toca
// alguno de los dos hay que ajustar el otro) para que el subtítulo quede
// integrado sobre la foto, y el borde derecho casi llega al borde de
// pantalla para que el tubo de neón respire ahí.
const FOCAL_POSITION = "50% 64%";

// Ajuste puramente de posición (no de tamaño/recorte): el bloque sube vía
// la propiedad CSS "translate" (no "transform"), no tocando top/bottom, así
// el alto del contenedor -y por lo tanto el cálculo de object-fit:cover-
// queda idéntico; solo cambia dónde se pinta en pantalla. Va como clase de
// Tailwind (no inline style) a propósito: GSAP anima "transform" en este
// mismo elemento (parallax de scroll, más abajo) y "translate"/"transform"
// son propiedades CSS separadas que componen sin pisarse — si esto fuera
// inline style.transform, cada tick del scrub de GSAP lo sobreescribiría.
// NeonLights.tsx reusa esta misma constante en el tubo derecho para que
// ambos se muevan juntos.
export const SCENE_LIFT_CLASS =
  "-translate-y-[126px] sm:-translate-y-[196px] md:-translate-y-[208px]";

// Los valores de top de abajo (284/366/386) son los originales del <img>
// (204/286/306, ver su comentario) + 80px: bajan el borde superior del
// marco (recorta cielo/estantería, no piso) sin tocar el borde inferior
// ni el alto real de la imagen, así que esto es puro recorte del extremo
// superior, no zoom ni reencuadre.
//
// bottom-[-180px] (no bottom-0): este contenedor es la ÚNICA pieza con
// overflow-hidden en toda la cadena (el bloque de abajo, el que tiene la
// <img>, es overflow:visible) — es literalmente el ancestro que recorta.
// Con bottom-0 su ventana de recorte terminaba justo donde termina la
// <section> (la altura real del hero), tapando la base/apoyapiés que la
// caja de abajo ya renderiza más grande ahora (ver su comentario). Bajar
// este borde 180px agranda esa ventana para que se vea todo eso, sin
// tocar object-fit, object-position ni scale del <img> — es pura ventana
// de recorte. El límite real de cuánto puede bajar es la propia
// <section> (min-h-svh, overflow-hidden): pasado ese punto, ella misma
// vuelve a recortar sin importar qué tan grande sea esta ventana — por
// eso el valor de la caja de abajo (próximo comentario) está calibrado
// para no pasarse de ese límite ni siquiera en mobile.
export const Scene = React.forwardRef<HTMLDivElement>(function Scene(_props, ref) {
  return (
    <div
      ref={ref}
      className={`absolute -z-20 left-6 right-2 top-[284px] bottom-[-180px] overflow-hidden sm:left-12 sm:right-4 sm:top-[366px] md:left-20 md:right-6 md:top-[386px] ${SCENE_LIFT_CLASS}`}
      style={{
        // La foto (más abajo) mantiene su tamaño real de siempre y su propio
        // fundido a transparente en el 8% superior de ESA altura original;
        // como ahora el contenedor recorta antes de llegar ahí, ese fundido
        // quedaría oculto y el borde nuevo se vería "cortado a cuchillo". Este
        // segundo fundido, en cambio, es relativo a la altura ya recortada del
        // contenedor (0% = el nuevo borde visible), así que sí actúa donde se
        // ve el corte.
        maskImage: "linear-gradient(180deg, transparent 0%, white 10%, white 100%)",
        WebkitMaskImage: "linear-gradient(180deg, transparent 0%, white 10%, white 100%)",
      }}
    >
      {/* Esta caja (overflow:visible, sin recortar nada por sí misma) es
          la que le da su alto a la <img> de adentro (h-full) — por lo
          tanto la que decide cuánto contenido calcula object-fit:cover,
          no el contenedor de arriba. Antes tenía menos alto y colgaba de
          "bottom-0" (atada al piso del contenedor de arriba); ahora tiene
          más alto (100svh menos un número más chico: menos recorte
          propio) y cuelga de un "top" fijo en vez de "bottom" — clave
          para que el crecimiento se sienta SOLO hacia abajo: con
          bottom-0, agrandar el alto también corre el borde de ARRIBA
          (mueve el punto de anclaje); con top fijo, el borde de arriba
          queda clavado en su lugar de siempre y todo el alto de más se
          nota abajo. object-position/transform siguen siendo los mismos
          valores de código (FOCAL_POSITION, scale) — lo único que cambió
          es cuánta imagen entra en el cálculo de partida.
          top-[-75px] (un solo valor, no por breakpoint): compensa el
          leve corrimiento que el propio alto extra le mete al punto de
          anclaje del focal point (medido en pantalla, no supuesto) para
          que el borde superior quede pixel-igual al de antes de este
          cambio. Los tres valores de alto (99/136/156, uno por
          breakpoint) SÍ están calibrados por separado: no es el mismo
          número en los tres porque cada uno está ajustado al máximo que
          entra sin que la propia <section> (el padre con overflow-hidden
          y min-h-svh, ver comentario del contenedor de arriba) vuelva a
          recortar por su cuenta — en mobile hay mucho menos margen entre
          el hero y el borde de la sección que en desktop. */}
      <div className="absolute inset-x-0 top-[-75px] h-[calc(100svh-99px)] sm:h-[calc(100svh-136px)] md:h-[calc(100svh-156px)]">
        {/* La imagen y su overlay son ambos "absolute" a propósito: un
            <img> normal es inline-level y pinta ANTES que cualquier
            descendiente posicionado (aunque venga después en el DOM), así
            que un overlay "absolute" quedaba pintándose siempre encima y
            tapaba la foto por completo. Con los dos absolute, el orden en
            el DOM decide el stacking. */}
        <img
          src={sceneImg}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            objectPosition: FOCAL_POSITION,
            transform: "scale(1.05)",
            transformOrigin: FOCAL_POSITION,
          }}
        />
        {/* Viñeta fotográfica: nítido/cálido en el centro (la silla), se
            apaga hacia los bordes — simula profundidad de campo y funde la
            foto con el negro de la página. Sesgada a la derecha para que el
            tubo de neón se funda con el fondo cerca del borde. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(95% 85% at 42% 48%, transparent 44%, rgba(5,3,8,0.2) 68%, rgba(5,3,8,0.55) 88%, #050308 100%)",
          }}
        />
      </div>
    </div>
  );
});
