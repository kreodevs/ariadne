import { describe, expect, it } from 'vitest';
import { wantsFullComponentListing, wantsFullGenericIndexedInventory } from './chat.constants';

describe('wantsFullComponentListing', () => {
  it('detecta intención de listado completo de componentes', () => {
    expect(wantsFullComponentListing('dame la lista completa de componentes que tiene este monorepo')).toBe(true);
    expect(wantsFullComponentListing('Todos los componentes del repo')).toBe(true);
    expect(wantsFullComponentListing('enumerar todos los componentes')).toBe(true);
    expect(wantsFullComponentListing('full list of components')).toBe(true);
  });

  it('no dispara con endpoints o preguntas acotadas', () => {
    expect(wantsFullComponentListing('lista completa de rutas api')).toBe(false);
    expect(wantsFullComponentListing('dame todos los endpoints')).toBe(false);
    expect(wantsFullComponentListing('qué componentes hay en el login')).toBe(false);
    expect(wantsFullComponentListing('hablame de los componentes principales')).toBe(false);
  });

  it('sin resumir + componentes', () => {
    expect(wantsFullComponentListing('lista de componentes sin resumir')).toBe(true);
  });
});

describe('wantsFullGenericIndexedInventory', () => {
  it('detecta inventario amplio del índice', () => {
    expect(wantsFullGenericIndexedInventory('dame la lista completa de todas las entidades')).toBe(true);
    expect(wantsFullGenericIndexedInventory('lista de todos los elementos involucrados sin resumir')).toBe(true);
    expect(wantsFullGenericIndexedInventory('todos los nodos del grafo indexado')).toBe(true);
    expect(wantsFullGenericIndexedInventory('inventario completo del índice')).toBe(true);
    expect(wantsFullGenericIndexedInventory('full list of entities in the index')).toBe(true);
  });

  it('no roba el caso componentes-only', () => {
    expect(wantsFullGenericIndexedInventory('lista completa de componentes')).toBe(false);
    expect(wantsFullComponentListing('lista completa de componentes')).toBe(true);
  });

  it('no dispara sin intención de totalidad', () => {
    expect(wantsFullGenericIndexedInventory('qué entidades hay en login')).toBe(false);
    expect(wantsFullGenericIndexedInventory('lista completa de rutas api')).toBe(false);
  });
});
