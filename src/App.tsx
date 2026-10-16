import { NotificationCenter } from './components/common/NotificationCenter';
import { DialogHost } from './components/common/dialogs';
import { GlobalShortcuts } from './components/common/GlobalShortcuts';
import { MainLayout } from './components/layout/MainLayout';
import { HardwareSmoke } from './components/dev/HardwareSmoke';
import { PrintSmoke } from './components/dev/PrintSmoke';
import { PrintCsvSmoke } from './components/dev/PrintCsvSmoke';
import { useUrlSync } from './components/layout/useUrlSync';
import { useDocThumbnail } from './components/editor/useDocThumbnail';

function App() {
    // Hash routing lives for the app's lifetime (see `components/layout/useUrlSync`).
    useUrlSync();
    // Keeps gallery card previews fresh as the open document changes (D-50).
    useDocThumbnail();
    const params = new URLSearchParams(window.location.search);
    const showHardwareSmoke = params.has('hardware');
    const showPrintSmoke = params.has('print');
    const showPrintCsvSmoke = params.has('printcsv');
    return (
        <>
            <NotificationCenter />
            <DialogHost />
            <GlobalShortcuts />
            <MainLayout />
            {showHardwareSmoke && <HardwareSmoke />}
            {showPrintSmoke && <PrintSmoke />}
            {showPrintCsvSmoke && <PrintCsvSmoke />}
        </>
    );
}

export default App;
