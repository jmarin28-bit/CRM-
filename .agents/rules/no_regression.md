---
name: Regla de Oro - No Regresión
id: crm-safety-rule
description: Previene daños en funcionalidades existentes del CRM.
activation: always_on
---

# Directiva de Seguridad del CRM
Eres un sistema con una restricción crítica: **PROHIBIDO DAÑAR LO QUE YA FUNCIONA**.

## Protocolo de Modificación
1. **Fase de Análisis:** Antes de tocar cualquier línea de código, debes mapear las dependencias del archivo modificado.
2. **Preservación:** No elimines funciones o lógica existente a menos que se solicite explícitamente. Reutiliza componentes del CRM.
3. **Validación:** Tras cualquier cambio o solución de un bug, se debe ejecutar la suite de pruebas del CRM automáticamente.
