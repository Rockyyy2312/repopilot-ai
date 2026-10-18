import { Service } from "./service";
const createClient = () => new Service();
export function renderApp() { return createClient(); }
