const paths: Record<string, string> = {
    pause: '<path d="M8 5v14m8-14v14"/>',
    step: '<path d="m5 5 11 7-11 7V5Zm14 0v14"/>',
    rotate: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
    scale: '<path d="M4 20 20 4M13 4h7v7M4 13v7h7"/>',
    snap: '<path d="M5 4v10a7 7 0 0 0 14 0V4h-4v10a3 3 0 0 1-6 0V4H5Zm0 5h4m6 0h4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0m-4 9v2"/>',
    cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-16.5 8 4.5"/>',
    sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    cylinder:
        '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 4 14 4 14 0V5M5 19c0-4 14-4 14 0"/>',
    plane: '<path d="m2 13 10-7 10 7-10 6-10-6Z"/>',
    group: '<path d="M3 6h7l2 3h9v11H3V6Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    hidden: '<path d="m3 3 18 18M10 5c8-1 12 7 12 7s-1 2-3 3M6 6c-3 2-4 6-4 6s4 7 10 7c2 0 4-1 5-2"/>',
    play: '<path d="m8 4 12 8-12 8V4Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    save: '<path d="M4 3h13l4 4v14H3V3h1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    export: '<path d="M12 15V3m-5 5 5-5 5 5M4 14v7h16v-7"/>',
    import: '<path d="M12 3v12m-5-5 5 5 5-5M4 14v7h16v-7"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v4"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v4"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    grid: '<path d="M3 3h18v18H3V3Zm6 0v18m6-18v18M3 9h18M3 15h18"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
    move: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    material: '<circle cx="12" cy="12" r="9"/><path d="M6 6c12-3 15 10 8 14M4 16c3-6 10-9 16-7"/>',
    settings:
        '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    terminal: '<path d="m4 5 6 6-6 6m8 1h8"/>',
    camera: '<path d="m3 7 5-1 2-3h4l2 3 5 1v13H3V7Z"/><circle cx="12" cy="13" r="4"/>'
};

export function icon(name: string, className = ''): string {
    return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths['cube'] ?? ''}</svg>`;
}
