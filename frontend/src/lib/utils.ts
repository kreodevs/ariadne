/**
 * @fileoverview Utilidades CSS: cn (clsx + tailwind-merge) para clases condicionales y resolución de conflictos Tailwind.
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Combina clases CSS con clsx y resuelve conflictos de Tailwind con twMerge.
 * @param inputs - Clases, objetos condicionales o arrays de clases
 * @returns string de clases CSS listas para aplicar
 * @inCalls 36+ — Utilidad de uso masivo en UI; cambios afectan muchos componentes. Mantener firma estable.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
