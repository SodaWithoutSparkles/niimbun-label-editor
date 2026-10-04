import { NotificationCenter } from './components/common/NotificationCenter';
import { DialogHost } from './components/common/dialogs';
import { GlobalShortcuts } from './components/common/GlobalShortcuts';
import { MainLayout } from './components/layout/MainLayout';
import { HardwareSmoke } from './components/dev/HardwareSmoke';

function App() {
    const showHardwareSmoke = new URLSearchParams(window.location.search).has('hardware');
    return (
        <>
            <NotificationCenter />
            <DialogHost />
            <GlobalShortcuts />
            <MainLayout />
            {showHardwareSmoke && <HardwareSmoke />}
        </>
    );
}

export default App;
