/**
 * Editor de ALIAS DE VOZ para empresas y contactos (punto 4 del reporte).
 *
 * ------------------------------------------------------------------------
 * PARA QUÉ SIRVE
 * ------------------------------------------------------------------------
 * El asistente de cotización se alimenta de dictado. El reconocimiento de voz
 * transcribe razonablemente bien los nombres comunes, pero se rinde con las
 * razones sociales escritas en siglas: "H.I.P.I.C.O. S.A.S." se dicta
 * "hipico" y se transcribe "hipico", que no se parece a nada de lo que hay
 * guardado. Lo mismo pasa con los apodos: nadie dicta "María José Restrepo
 * Ángel", dicta "majo".
 *
 * Guardando esos alias, el emparejador (services/quoteParser.ts) los reconoce
 * dentro de la frase dictada y selecciona el registro correcto.
 *
 * ------------------------------------------------------------------------
 * POR QUÉ NO ES UN CAMPO DE TEXTO A SECAS
 * ------------------------------------------------------------------------
 * Un alias mal puesto es peligroso: si alguien guarda "de" como alias, esa
 * empresa gana en casi cualquier dictado, que es exactamente el bug que
 * originó todo este trabajo. Por eso el editor:
 *
 *   - exige 3 caracteres como mínimo,
 *   - rechaza duplicados dentro del mismo registro,
 *   - normaliza (minúsculas, sin tildes, siglas con puntos colapsadas) para
 *     que se guarde lo mismo que el parser va a comparar,
 *   - y muestra los alias como fichas, para que se vea de un golpe cuántos
 *     hay y se puedan quitar.
 */
import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import { aliasesOf, collapseAcronymDots } from "../services/quoteParser";

/** Mínimo de caracteres de un alias. Coincide con el del parser. */
const MIN_ALIAS_LENGTH = 3;

export interface AliasEditorProps {
  /** Alias actuales del registro. */
  value: string[] | undefined;
  /** Se llama con la lista completa ya normalizada. */
  onChange: (aliases: string[]) => void;
  /** Nombre real del registro, para el texto de ayuda. */
  entityName?: string;
  /** "empresa" | "contacto" — solo cambia el texto. */
  kind?: "empresa" | "contacto";
  disabled?: boolean;
}

export const AliasEditor: React.FC<AliasEditorProps> = ({
  value,
  onChange,
  entityName,
  kind = "empresa",
  disabled = false,
}) => {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const aliases = aliasesOf({ aliases: value });

  const add = () => {
    const candidate = collapseAcronymDots(input);

    if (!candidate) {
      setError("Escribe el alias tal como lo dictas.");
      return;
    }
    if (candidate.length < MIN_ALIAS_LENGTH) {
      setError(
        `Muy corto. Un alias de una o dos letras coincidiría con casi cualquier dictado y seleccionaría esta ${kind} por error.`
      );
      return;
    }
    if (aliases.includes(candidate)) {
      setError("Ese alias ya está en la lista.");
      return;
    }

    onChange([...aliases, candidate]);
    setInput("");
    setError("");
  };

  const remove = (alias: string) => {
    onChange(aliases.filter((a) => a !== alias));
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
          Alias de voz (asistente de cotización)
        </label>
        <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
          Cómo se dicta {entityName ? `«${entityName}»` : `esta ${kind}`} en voz
          alta. Por ejemplo, si la razón social es «H.I.P.I.C.O. S.A.S.» pero
          dictas «hipico», guarda <span className="font-bold">hipico</span>.
        </p>
      </div>

      {aliases.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {aliases.map((alias) => (
            <span
              key={alias}
              className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold"
            >
              {alias}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(alias)}
                  aria-label={`Quitar alias ${alias}`}
                  className="text-blue-400 hover:text-red-500 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="flex gap-2">
          <input
            className="flex-1 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
            placeholder="hipico"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              // Enter añade el alias; sin esto el Enter enviaría el formulario
              // que envuelve al editor y guardaría el registro a medias.
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button
            type="button"
            onClick={add}
            className="shrink-0 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors inline-flex items-center gap-1.5"
          >
            <Plus size={12} />
            Añadir
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-600 font-bold leading-relaxed">
          {error}
        </p>
      )}

      {aliases.length === 0 && !error && (
        <p className="text-[11px] text-slate-400 font-medium">
          Sin alias. El asistente buscará solo por el nombre registrado.
        </p>
      )}
    </div>
  );
};

export default AliasEditor;
