import { useTranslation } from 'react-i18next';
import { Modal } from '../common/dialogs';

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const HelpModal = ({ isOpen, onClose }: HelpModalProps) => {
    const { t } = useTranslation();

    return (
        <Modal open={isOpen} onClose={onClose} title={t('help.title')} size="lg">
            <div className="space-y-3 text-sm text-gray-300">
                <p>{t('help.intro')}</p>
                <p>{t('help.panels')}</p>
            </div>
        </Modal>
    );
};
