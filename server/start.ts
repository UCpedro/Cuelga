import { localServer } from './app';
const server = localServer();
server.listen(8789, '127.0.0.1', () => console.log('Harness D48 en http://127.0.0.1:8789; sólo datos ficticios; sin proveedores.'));
