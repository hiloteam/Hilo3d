const gallery = new URL('./list.html', location.href);
gallery.search = location.search;
gallery.hash = location.hash;
location.replace(gallery.href);
