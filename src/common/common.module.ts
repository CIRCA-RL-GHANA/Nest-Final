import { Module, Global } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { NotificationService } from './services/notification.service';

@Global()
@Module({
  providers: [EmailService, NotificationService],
  exports: [EmailService, NotificationService],
})
export class CommonModule {}
