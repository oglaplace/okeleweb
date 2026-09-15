/**
 * UNE PHOTO D'IDENTITÉ, PAS UNE PHOTO DE PROFIL.
 *
 * Ce que ces portraits servent: une pastille de 28 px dans une liste, une
 * vignette de 144 px sur une fiche, un carré sur un bulletin imprimé. Ce qui
 * arrivait: le JPEG de 3 Mo que le téléphone du secrétariat venait de prendre,
 * encodé en base64 — donc un tiers de plus — poussé tel quel à travers une
 * liaison mobile congolaise, puis stocké en base et renvoyé à chaque affichage
 * de la liste.
 *
 * On redimensionne donc AVANT d'envoyer, dans le navigateur, une fois. 320 px
 * sur le plus grand côté est le double de ce que le plus grand usage demande —
 * assez pour un écran à densité double — et le résultat tient en une vingtaine
 * de kilo-octets au lieu de trois mille.
 *
 * Toujours en JPEG: un PNG de portrait est trois fois plus lourd pour un
 * résultat que personne ne distingue, et la transparence ne veut rien dire sur
 * un visage. Le serveur accepte les trois formats, c'est le client qui choisit.
 */

/** Le plus grand côté, en pixels. Le ratio d'origine est conservé. */
export const PORTRAIT_MAX_PX = 320;

/**
 * 0.62 plutôt que 0.8: sur un visage à 320 px la différence ne se voit pas, et
 * elle pèse presque la moitié du fichier.
 */
export const PORTRAIT_QUALITY = 0.62;

/** Ce que le serveur accepte, restated — voir decodePhoto côté API. */
export const PORTRAIT_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** La limite de l'ENVOI, avant réduction. Après, il en reste un centième. */
export const PORTRAIT_MAX_BYTES = 8 * 1024 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

/**
 * Le fichier choisi, réduit et réencodé, prêt pour l'API.
 *
 * En cas d'échec du canvas — un navigateur ancien, une image que le décodeur
 * refuse — on renvoie l'original plutôt que rien: une photo lourde vaut mieux
 * qu'une inscription bloquée, et le serveur pose sa propre limite de toute
 * façon.
 */
export async function toPortraitDataUrl(file: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PORTRAIT_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    // Un portrait réduit de 3000 à 320 px sans lissage est un damier.
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const out = canvas.toDataURL("image/jpeg", PORTRAIT_QUALITY);
    // Un canvas « propre » renvoie au minimum un en-tête; tout ce qui est plus
    // court que cela n'est pas une image et l'original vaut mieux.
    return out.length > 64 ? out : await readAsDataUrl(file);
  } catch {
    return readAsDataUrl(file);
  }
}

/** Ce qui cloche avec ce fichier, en une phrase, ou null. */
export function portraitRefusal(file: File): string | null {
  if (!PORTRAIT_TYPES.includes(file.type)) {
    return "Format accepté : JPEG, PNG ou WebP.";
  }
  if (file.size > PORTRAIT_MAX_BYTES) {
    return `Photo trop lourde (${(file.size / 1024 / 1024).toFixed(1)} Mo, maximum 8 Mo).`;
  }
  return null;
}
