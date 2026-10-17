// Colores de los estados comerciales: de neutro a verde según avanza; "No contactar" en rojo.
export const CRM_TONE: Record<string, { bg: string; fg: string }> = {
  nuevo: { bg: "#eef1f0", fg: "#3d4f52" },
  pendiente: { bg: "#eef1f0", fg: "#3d4f52" },
  contactado: { bg: "#e4edf5", fg: "#1f4e78" },
  respondio: { bg: "#e4edf5", fg: "#1f4e78" },
  interesado: { bg: "#e3efe8", fg: "#23553f" },
  negociacion: { bg: "#e3efe8", fg: "#23553f" },
  cliente: { bg: "#2d6a4f", fg: "#ffffff" },
  no_interesado: { bg: "#f1efe9", fg: "#6b5d45" },
  no_contactar: { bg: "#f8e7e5", fg: "#a8322a" },
  default: { bg: "#eef1f0", fg: "#3d4f52" },
};
