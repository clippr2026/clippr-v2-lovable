// Bandera (emoji) de cada nacionalidad que se puede elegir en el perfil profesional.
const FLAGS: Record<string, string> = {
  Argentina: "🇦🇷",
  Bolivia: "🇧🇴",
  Brasil: "🇧🇷",
  Chile: "🇨🇱",
  Colombia: "🇨🇴",
  Cuba: "🇨🇺",
  Ecuador: "🇪🇨",
  España: "🇪🇸",
  Italia: "🇮🇹",
  México: "🇲🇽",
  Paraguay: "🇵🇾",
  Perú: "🇵🇪",
  "República Dominicana": "🇩🇴",
  Uruguay: "🇺🇾",
  Venezuela: "🇻🇪",
};

export function countryFlag(name: string | null | undefined): string {
  return (name && FLAGS[name.trim()]) || "🌎";
}
