import { NotificationCenter } from './components/common/NotificationCenter';
import { DialogHost } from './components/common/dialogs';
import { GlobalShortcuts } from './components/common/GlobalShortcuts';
import { MainLayout } from './components/layout/MainLayout';
import { HardwareSmoke } from './components/dev/HardwareSmoke';
import { PrintSmoke } from './components/dev/PrintSmoke';

function App() {
    const params = new URLSearchParams(window.location.search);
    const showHardwareSmoke = params.has('hardware');
    const showPrintSmoke = params.has('print');
    return (
        <>
            <NotificationCenter />
            <DialogHost />
            <GlobalShortcuts />
            <MainLayout />
            {showHardwareSmoke && <HardwareSmoke />}
            {showPrintSmoke && <PrintSmoke />}
        </>
    );
}

export default App;
