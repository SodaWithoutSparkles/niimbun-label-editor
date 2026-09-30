import { NotificationCenter } from './components/common/NotificationCenter';
import { DialogHost } from './components/common/dialogs';
import { MainLayout } from './components/layout/MainLayout';

function App() {
    return (
        <>
            <NotificationCenter />
            <DialogHost />
            <MainLayout />
        </>
    );
}

export default App;
